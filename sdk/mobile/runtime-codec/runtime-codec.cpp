// Build-time asset compression only. This tool is never linked into the app.
#include "libzpaq.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <stdexcept>

namespace libzpaq { void error(const char* message) { throw std::runtime_error(message); } }

struct Input final : libzpaq::Reader {
    FILE* file;
    explicit Input(const char* path) : file(std::fopen(path, "rb")) {
        if (!file) throw std::runtime_error("Cannot open runtime input");
    }
    ~Input() { std::fclose(file); }
    int get() override { return std::getc(file); }
    int read(char* bytes, int size) override { return int(std::fread(bytes, 1, size, file)); }
};

struct Output final : libzpaq::Writer {
    FILE* file;
    unsigned long long count = 0, limit;
    Output(const char* path, unsigned long long maximum) : file(std::fopen(path, "wb")), limit(maximum) {
        if (!file) throw std::runtime_error("Cannot open runtime output");
    }
    ~Output() { std::fclose(file); }
    void put(int byte) override {
        if (count >= limit || std::putc(byte, file) == EOF) throw std::runtime_error("Invalid runtime output size or write failure");
        ++count;
    }
    void write(const char* bytes, int size) override {
        if (size < 0 || static_cast<unsigned long long>(size) > limit - count ||
            std::fwrite(bytes, 1, size, file) != static_cast<size_t>(size)) throw std::runtime_error("Invalid runtime output size or write failure");
        count += size;
    }
};

int main(int argc, char** argv) {
    try {
        if (argc != 5 && argc != 6) throw std::runtime_error("Usage: runtime-codec encode|decode input output decoded-bytes [encoder-method]");
        char* end = nullptr;
        const auto expected = std::strtoull(argv[4], &end, 10);
        if (!end || *end || !expected || expected > 32 * 1024 * 1024) throw std::runtime_error("Invalid runtime size limit");
        const bool encode = std::strcmp(argv[1], "encode") == 0;
        if (!encode && std::strcmp(argv[1], "decode") != 0) throw std::runtime_error("Unknown codec operation");
        Input input(argv[2]);
        Output output(argv[3], encode ? expected + 1024 * 1024 : expected);
        if (encode) libzpaq::compress(&input, &output, argc == 6 ? argv[5] : "56,120,0", "runtime.bin");
        else {
            libzpaq::Decompresser decoder;
            decoder.setInput(&input);
            double memory = 0;
            while (decoder.findBlock(&memory)) {
                if (memory > 1024 * 1024 * 1024) throw std::runtime_error("Runtime decoder memory limit exceeded");
                while (decoder.findFilename()) {
                    decoder.readComment();
                    decoder.setOutput(&output);
                    libzpaq::SHA1 checksum;
                    decoder.setSHA1(&checksum);
                    while (decoder.decompress(1024 * 1024)) {}
                    char expectedHash[21];
                    decoder.readSegmentEnd(expectedHash);
                    if (expectedHash[0] == 1 && std::memcmp(expectedHash + 1, checksum.result(), 20)) throw std::runtime_error("Runtime checksum mismatch");
                }
            }
            if (output.count != expected) throw std::runtime_error("Incomplete runtime output");
        }
        if (std::fflush(output.file) || std::ferror(input.file)) throw std::runtime_error("Runtime IO failure");
    } catch (const std::exception& error) {
        std::fprintf(stderr, "%s\n", error.what());
        return 1;
    }
    return 0;
}
