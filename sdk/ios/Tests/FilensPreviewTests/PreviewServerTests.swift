import Foundation
import XCTest
@testable import FilensPreview

final class PreviewServerTests: XCTestCase {
    func testSessionPathCannotEscapeAssets() {
        XCTAssertEqual(PreviewServer.relativePath("/token/assets/worker.js?v=1", token: "token"), "assets/worker.js")
        for path in ["?", "/", "/other/document", "/token/../secret", "/token/%2e%2e/secret",
                     "/token/assets%2f..%2fsecret", "/token/assets\\secret", "/token/%00", "/token//file"] {
            XCTAssertNil(PreviewServer.relativePath(path, token: "token"), path)
        }
    }

    func testMediaByteRanges() throws {
        XCTAssertEqual(try PreviewServer.byteRange(nil, length: 10), 0..<10)
        XCTAssertEqual(try PreviewServer.byteRange(nil, length: 0), 0..<0)
        XCTAssertEqual(try PreviewServer.byteRange("bytes=2-4", length: 10), 2..<5)
        XCTAssertEqual(try PreviewServer.byteRange("bytes=7-", length: 10), 7..<10)
        XCTAssertEqual(try PreviewServer.byteRange("bytes=-3", length: 10), 7..<10)
        XCTAssertEqual(try PreviewServer.byteRange("bytes=5-999", length: 10), 5..<10)
        for value in ["bytes=10-", "bytes=-0", "bytes=6-2", "bytes=0-1,3-4", "bytes=a-b", "bytes=0-18446744073709551616"] {
            XCTAssertThrowsError(try PreviewServer.byteRange(value, length: 10), value)
        }
        XCTAssertThrowsError(try PreviewServer.byteRange("bytes=0-", length: 0))
    }

    func testRealLoopbackTransport() throws {
        let work = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: work) }
        try Data("export const answer = 42;".utf8).write(to: work.appendingPathComponent("mobile.js"))
        let input = work.appendingPathComponent("private.txt")
        try Data("0123456789".utf8).write(to: input)
        let server = PreviewServer(assets: work, document: input, metadata: Data("{}".utf8))
        defer { server.stop() }
        let ready = expectation(description: "listener ready")
        var base: URL!
        try server.start { result in base = try? result.get(); ready.fulfill() }
        wait(for: [ready], timeout: 5)
        let url = try XCTUnwrap(base)
        let checks = expectation(description: "HTTP checks")
        checks.expectedFulfillmentCount = 7
        for (name, method, headers, status, expected) in [
            ("document", "GET", ["Range": "bytes=2-4"], 206, "234"),
            ("document", "HEAD", [:], 200, ""),
            ("document", "GET", ["Range": "bytes=50-"], 416, ""),
            ("document", "GET", ["Origin": "https://example.com"], 403, ""),
            ("document", "POST", [:], 405, ""),
            ("source.json", "GET", [:], 200, "{}"),
            ("mobile.js", "GET", [:], 200, "export const answer = 42;")
        ] {
            var request = URLRequest(url: url.deletingLastPathComponent().appendingPathComponent(name))
            request.httpMethod = method
            for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
            URLSession.shared.dataTask(with: request) { data, response, error in
                XCTAssertNil(error)
                XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, status)
                XCTAssertEqual(String(decoding: data ?? Data(), as: UTF8.self), expected)
                checks.fulfill()
            }.resume()
        }
        wait(for: [checks], timeout: 5)
    }
}
