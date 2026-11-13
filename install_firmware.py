"""One-time, application-only installer using the official esptool package.

Reads and verifies the actual partition table and selected boot slot before writing.
Does not erase NVS, otadata, partition tables, bootloaders or the acquisition MCU.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import struct
from types import SimpleNamespace
import zlib

ROOT = Path(__file__).resolve().parent


def partitions(raw):
    result = []
    for i in range(0, len(raw) - 31, 32):
        magic, kind, subtype, offset, size, label, flags = struct.unpack_from('<HBBII16sI', raw, i)
        if magic != 0x50AA:
            break
        result.append(dict(kind=kind, subtype=subtype, offset=offset, size=size,
                           label=label.split(b'\0', 1)[0].decode('ascii'), flags=flags))
    return result


def selected_application(parts, otadata):
    ota = sorted((p for p in parts if p['kind'] == 0 and 0x10 <= p['subtype'] <= 0x1F), key=lambda p: p['subtype'])
    records = []
    for offset in (0, 4096):
        if len(otadata) < offset + 32:
            raise ValueError('Incomplete otadata')
        seq = struct.unpack_from('<I', otadata, offset)[0]
        state, crc = struct.unpack_from('<II', otadata, offset + 24)
        valid_crc = zlib.crc32(struct.pack('<I', seq), 0xFFFFFFFF) & 0xFFFFFFFF
        if seq != 0xFFFFFFFF and state not in (3, 4) and crc == valid_crc:
            if state == 1:
                raise ValueError('Pending rollback verification; boot the existing application normally first')
            records.append(seq)
    if records:
        if not ota or [p['subtype'] for p in ota] != list(range(0x10, 0x10 + len(ota))):
            raise ValueError('Unsupported OTA slot layout')
        return ota[(max(records) - 1) % len(ota)]
    if otadata != b'\xFF' * len(otadata):
        raise ValueError('No unambiguous valid boot entry; refusing to guess the application slot')
    factory = next((p for p in parts if p['kind'] == 0 and p['subtype'] == 0), None)
    if not factory:
        raise ValueError('No factory application')
    return factory


def validate_image(raw):
    if len(raw) < 288 or raw[0] != 0xE9 or struct.unpack_from('<H', raw, 12)[0] != 9:
        raise ValueError('Not an ESP32-S3 application image')
    if struct.unpack_from('<I', raw, 32)[0] != 0xABCD5432:
        raise ValueError('Application descriptor missing')
    project = raw[80:112].split(b'\0', 1)[0].decode('utf-8')
    if project != 'NV3049F':
        raise ValueError('Image does not belong to the Fusion NV3049F project')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port')
    parser.add_argument('--baud', type=int, default=921600)
    parser.add_argument('--inspect-only', action='store_true', help='read device layout without writing')
    args = parser.parse_args()
    import esptool
    from esptool.targets.esp32s3 import ESP32S3ROM
    from serial.tools import list_ports
    if not esptool.__version__.startswith('4.'):
        raise RuntimeError('Use the ESP-IDF bundled Python with esptool 4.x')
    manifest = json.loads((ROOT / 'firmware' / 'manifest.json').read_text(encoding='utf-8'))
    image_path = ROOT / 'firmware' / manifest['file']
    image = image_path.read_bytes()
    validate_image(image)
    if hashlib.sha256(image).hexdigest() != manifest['sha256']:
        raise ValueError('Firmware SHA256 mismatch')
    expected_table = (ROOT / 'firmware' / 'partition-table.bin').read_bytes()
    if hashlib.sha256(expected_table).hexdigest() != manifest['partitionSha256']:
        raise ValueError('Reference partition table SHA256 mismatch')
    if not args.port:
        for port in list_ports.comports():
            print(f'{port.device}: {port.description}')
        args.port = input('ESP32-S3 port (for example COM31): ').strip()
    if not args.port:
        raise ValueError('No port selected')
    print('Close the serial connection in the web upper computer before continuing.')
    rom = esptool.detect_chip(args.port, baud=115200, connect_attempts=3)
    esp = rom
    try:
        if rom.CHIP_NAME != 'ESP32-S3' or rom.get_secure_boot_enabled() or rom.get_flash_encryption_enabled():
            raise ValueError('Target chip or security state is incompatible with this application-only installer')
        esp = rom.run_stub()
        esp.change_baud(args.baud)
        esp.flash_spi_attach(0)
        esp.flash_set_parameters(16 * 1024 * 1024)
        actual_table = esp.read_flash(0x8000, 4096)
        if actual_table[:len(expected_table)] != expected_table:
            raise ValueError('Device partition table differs from this Fusion project; no write performed')
        parts = partitions(actual_table)
        boot = next(p for p in parts if p['kind'] == 1 and p['subtype'] == 0)
        otadata = esp.read_flash(boot['offset'], boot['size'])
        target = selected_application(parts, otadata)
        header = esp.read_flash(target['offset'], 288)
        validate_image(header)
        if len(image) > target['size']:
            raise ValueError('Image exceeds the selected application partition')
        print(f"Selected application: {target['label']} @ 0x{target['offset']:X}; {len(image)} bytes")
        if args.inspect_only:
            print('Inspection complete. No flash write performed.')
            esp.hard_reset()
            return
        backup = ROOT / 'backups' / ('device-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
        backup.mkdir(parents=True)
        (backup / 'partition-table.bin').write_bytes(actual_table)
        (backup / 'otadata.bin').write_bytes(otadata)
        (backup / 'target.json').write_text(json.dumps(target, indent=2), encoding='utf-8')
        # Preserve calibration/settings plus their optional NVS keys as raw data.
        # These partitions are read only; application installation never writes them.
        nv_backups = []
        for part in parts:
            if part['kind'] == 1 and part['subtype'] in (2, 4):
                name = f"data-{part['offset']:x}.bin"
                data = esp.read_flash(part['offset'], part['size'])
                (backup / name).write_bytes(data)
                nv_backups.append(dict(part, file=name, sha256=hashlib.sha256(data).hexdigest()))
        (backup / 'nonvolatile-data.json').write_text(json.dumps(nv_backups, indent=2), encoding='utf-8')
        # Read the original full app partition before modifying a single byte.
        print('Backing up the existing application partition...')
        (backup / 'original-application.bin').write_bytes(esp.read_flash(target['offset'], target['size']))
        print('Writing application only. NVS, boot data and partition table are preserved.')
        with image_path.open('rb') as handle:
            write_args = SimpleNamespace(addr_filename=[(target['offset'], handle)],
                compress=True, no_compress=False, no_stub=False, force=False,
                encrypt=False, encrypt_files=None, erase_all=False,
                ignore_flash_encryption_efuse_setting=False,
                flash_mode='keep', flash_size='keep', flash_freq='keep')
            esptool.write_flash(esp, write_args)
        if esp.flash_md5sum(target['offset'], len(image)).lower() != hashlib.md5(image).hexdigest():
            raise RuntimeError('Flash MD5 verification failed')
        print(f'Application verified. Original image backup: {backup}')
        esp.hard_reset()
        print('Reconnect in the web upper computer and verify the web protocol, version and SN.')
    finally:
        esp._port.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'INSTALLATION STOPPED: {exc}')
        raise SystemExit(1)
