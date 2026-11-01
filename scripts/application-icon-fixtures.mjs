// Synthetic, non-executable packages and resource containers for conversion tests.
export function applicationIconFixtures(storeZip) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const ico = Buffer.alloc(22);
  ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico[6] = ico[7] = 1;
  ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
  const pe = Buffer.alloc(0x300 + png.length);
  pe.write('MZ'); pe.writeUInt32LE(0x80, 0x3c); pe.write('PE\0\0', 0x80);
  pe.writeUInt16LE(1, 0x86); pe.writeUInt16LE(224, 0x94); pe.writeUInt16LE(0x10b, 0x98);
  pe.writeUInt32LE(0x1000, 0x108); pe.writeUInt32LE(pe.length - 0x200, 0x10c);
  pe.writeUInt32LE(0x1000, 0x184); pe.writeUInt32LE(pe.length - 0x200, 0x188); pe.writeUInt32LE(0x200, 0x18c);
  for (const [at, id, child] of [[0x200, 3, 0x80000020], [0x220, 1, 0x80000040], [0x240, 1033, 0x60]]) {
    pe.writeUInt16LE(1, at + 14); pe.writeUInt32LE(id, at + 16); pe.writeUInt32LE(child, at + 20);
  }
  pe.writeUInt32LE(0x1100, 0x260); pe.writeUInt32LE(png.length, 0x264); png.copy(pe, 0x300);
  const apk = storeZip([['AndroidManifest.xml', Buffer.from('<manifest/>')], ['res/mipmap-mdpi/ic_launcher.png', png]]);
  const ipa = storeZip([['Payload/Fixture.app/Info.plist', Buffer.from('<plist><dict><key>CFBundleIconFiles</key><array><string>FixtureIcon</string></array></dict></plist>')], ['Payload/Fixture.app/FixtureIcon@2x.png', png]]);
  return [
    ['icons/sample.apk', apk], ['icons/sample.ipa', ipa], ['icons/sample.ico', Buffer.concat([ico, png])],
    ...['exe', 'dll', 'mui', 'mun'].map(ext => [`icons/sample.${ext}`, pe])
  ];
}
