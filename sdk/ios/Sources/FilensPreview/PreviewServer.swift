import Foundation
import Network

/// A private HTTP transport for WebKit module workers. No format handling lives here.
final class PreviewServer {
    private let assets: URL
    private let document: URL
    private let metadata: Data
    private let contentType: String
    private let token = UUID().uuidString
    private let queue = DispatchQueue(label: "app.filens.preview.http")
    private var listener: NWListener?
    private var connections: [ObjectIdentifier: NWConnection] = [:]
    private var pendingHeaders: Set<ObjectIdentifier> = []
    private var authority = ""

    init(assets: URL, document: URL, metadata: Data, contentType: String = "application/octet-stream") {
        self.assets = assets.resolvingSymlinksInPath()
        self.document = document
        self.metadata = metadata
        self.contentType = contentType
    }

    func start(completion: @escaping (Result<URL, Error>) -> Void) throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: parameters)
        self.listener = listener
        var completed = false
        listener.stateUpdateHandler = { [weak self, weak listener] state in
            guard let self else { return }
            switch state {
            case .ready:
                guard !completed, let port = listener?.port else { return }
                completed = true
                self.authority = "127.0.0.1:\(port.rawValue)"
                let url = URL(string: "http://\(self.authority)/\(self.token)/mobile.html")!
                DispatchQueue.main.async { completion(.success(url)) }
            case .failed(let error):
                if !completed {
                    completed = true
                    DispatchQueue.main.async { completion(.failure(error)) }
                }
                listener?.cancel()
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { connection.cancel(); return }
            let id = ObjectIdentifier(connection)
            self.connections[id] = connection
            self.pendingHeaders.insert(id)
            connection.stateUpdateHandler = { [weak self] state in
                switch state {
                case .cancelled, .failed:
                    self?.connections.removeValue(forKey: id)
                    self?.pendingHeaders.remove(id)
                default: break
                }
            }
            connection.start(queue: self.queue)
            self.receive(connection, buffer: Data())
            // Limit header reads without imposing a time limit on large file streams.
            self.queue.asyncAfter(deadline: .now() + 30) { [weak self, weak connection] in
                if self?.pendingHeaders.contains(id) == true { connection?.cancel() }
            }
        }
        listener.start(queue: queue)
    }

    func stop() {
        queue.sync {
            listener?.cancel()
            listener = nil
            for connection in connections.values { connection.cancel() }
            connections.removeAll()
            pendingHeaders.removeAll()
        }
    }

    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] bytes, _, done, error in
            guard let self else { connection.cancel(); return }
            var buffer = buffer
            if let bytes { buffer.append(bytes) }
            guard buffer.count <= 16384 else { self.reject(connection, status: 431); return }
            if let end = buffer.range(of: Data("\r\n\r\n".utf8)) {
                self.pendingHeaders.remove(ObjectIdentifier(connection))
                self.respond(connection, request: String(decoding: buffer[..<end.lowerBound], as: UTF8.self))
            } else if done || error != nil { connection.cancel() }
            else { self.receive(connection, buffer: buffer) }
        }
    }

    private func respond(_ connection: NWConnection, request: String) {
        let lines = request.components(separatedBy: "\r\n")
        let first = (lines.first ?? "").split(separator: " ")
        guard first.count == 3 else { reject(connection, status: 400); return }
        let method = String(first[0])
        guard method == "GET" || method == "HEAD" else { reject(connection, status: 405); return }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { reject(connection, status: 400); return }
            let name = line[..<colon].lowercased()
            guard headers[name] == nil else { reject(connection, status: 400); return }
            headers[name] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        guard headers["host"] == authority,
              headers["origin"] == nil || headers["origin"] == "http://\(authority)",
              headers["sec-fetch-site"] != "cross-site" else { reject(connection, status: 403); return }
        guard let relative = Self.relativePath(String(first[1]), token: token) else {
            reject(connection, status: 404); return
        }
        if relative == "source.json" {
            send(connection, data: metadata, type: "application/json", head: method == "HEAD")
            return
        }
        let file: URL
        if relative == "document" { file = document }
        else {
            file = assets.appendingPathComponent(relative).resolvingSymlinksInPath()
            guard file.path.hasPrefix(assets.path + "/") else { reject(connection, status: 404); return }
        }
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: file.path),
              attributes[.type] as? FileAttributeType == .typeRegular,
              let length = (attributes[.size] as? NSNumber)?.uint64Value,
              let handle = try? FileHandle(forReadingFrom: file) else { reject(connection, status: 404); return }
        let range: Range<UInt64>
        do { range = try Self.byteRange(headers["range"], length: length) }
        catch {
            try? handle.close()
            reject(connection, status: 416, extra: "Content-Range: bytes */\(length)\r\n")
            return
        }
        let partial = headers["range"] != nil
        let extra = partial ? "Content-Range: bytes \(range.lowerBound)-\(range.upperBound - 1)/\(length)\r\n" : ""
        let type = relative == "document" ? contentType : Self.mime(file)
        let header = Self.header(status: partial ? 206 : 200, length: range.count, type: type, extra: extra)
        connection.send(content: Data(header.utf8), completion: .contentProcessed { error in
            if error != nil || method == "HEAD" { try? handle.close(); connection.cancel(); return }
            do {
                try handle.seek(toOffset: range.lowerBound)
                self.stream(connection, handle: handle, remaining: UInt64(range.count))
            } catch { try? handle.close(); connection.cancel() }
        })
    }

    private func stream(_ connection: NWConnection, handle: FileHandle, remaining: UInt64) {
        guard remaining > 0 else { try? handle.close(); connection.cancel(); return }
        guard let bytes = try? handle.read(upToCount: Int(min(remaining, 65536))), !bytes.isEmpty else {
            try? handle.close(); connection.cancel(); return
        }
        connection.send(content: bytes, completion: .contentProcessed { error in
            if error != nil { try? handle.close(); connection.cancel(); return }
            self.stream(connection, handle: handle, remaining: remaining - UInt64(bytes.count))
        })
    }

    private func send(_ connection: NWConnection, data: Data, type: String, head: Bool) {
        var response = Data(Self.header(status: 200, length: data.count, type: type).utf8)
        if !head { response.append(data) }
        connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
    }

    private func reject(_ connection: NWConnection, status: Int, extra: String = "") {
        let header = Self.header(status: status, length: 0, type: "text/plain", extra: extra)
        connection.send(content: Data(header.utf8), completion: .contentProcessed { _ in connection.cancel() })
    }

    private static func header(status: Int, length: Int, type: String, extra: String = "") -> String {
        "HTTP/1.1 \(status) Response\r\nContent-Length: \(length)\r\nContent-Type: \(type)\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'self' blob: data:; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:; frame-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'none'\r\nAccept-Ranges: bytes\r\n\(extra)\r\n"
    }

    static func relativePath(_ target: String, token: String) -> String? {
        let path = String(target.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0])
        guard let decoded = path.removingPercentEncoding, decoded.hasPrefix("/\(token)/") else { return nil }
        let relative = String(decoded.dropFirst(token.count + 2))
        let parts = relative.split(separator: "/", omittingEmptySubsequences: false)
        guard !relative.contains("\\"), !relative.contains("\0"),
              parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { return nil }
        return relative
    }

    static func byteRange(_ value: String?, length: UInt64) throws -> Range<UInt64> {
        guard let value else { return 0..<length }
        let invalid = NSError(domain: "FilensPreview", code: 416)
        guard length > 0, value.hasPrefix("bytes=") else { throw invalid }
        let pieces = value.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
        guard pieces.count == 2 else { throw invalid }
        if pieces[0].isEmpty {
            guard let suffix = UInt64(pieces[1]), suffix > 0 else { throw invalid }
            return (length - min(length, suffix))..<length
        }
        guard let start = UInt64(pieces[0]), start < length else { throw invalid }
        if pieces[1].isEmpty { return start..<length }
        guard let end = UInt64(pieces[1]), end >= start else { throw invalid }
        return start..<(min(end, length - 1) + 1)
    }

    private static func mime(_ file: URL) -> String {
        switch file.pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "wasm": return "application/wasm"
        case "css": return "text/css"
        case "json": return "application/json"
        default: return "application/octet-stream"
        }
    }
}
