//! VIA 键盘探测:协议版本、灯光通道、Pro 固件支持。只读,不改任何灯效设置。

use std::time::Duration;

const USAGE_PAGE: u16 = 0xFF60;
const USAGE: u16 = 0x61;

fn xfer(dev: &hidapi::HidDevice, req: &[u8], label: &str) -> Option<[u8; 32]> {
    let mut out = [0u8; 33];
    out[1..1 + req.len()].copy_from_slice(req);
    if dev.write(&out).is_err() {
        println!("{label}: write failed");
        return None;
    }
    // 回应以请求前缀回显;跳过不相关帧(最多 10 帧)
    for _ in 0..10 {
        let mut buf = [0u8; 32];
        match dev.read_timeout(&mut buf, 300) {
            Ok(n) if n > 0 => {
                if buf[0] == req[0] || buf[0] == 0xFF {
                    let hex: Vec<String> = buf[..12.min(n)].iter().map(|b| format!("{b:02x}")).collect();
                    println!("{label}: [{}]", hex.join(" "));
                    return Some(buf);
                }
            }
            _ => break,
        }
    }
    println!("{label}: no reply");
    None
}

fn main() {
    let api = hidapi::HidApi::new().expect("hidapi");
    let mut found = false;
    for info in api.device_list() {
        if info.usage_page() != USAGE_PAGE || info.usage() != USAGE {
            continue;
        }
        found = true;
        println!(
            "device: vid={:04x} pid={:04x} product={:?} path={:?}",
            info.vendor_id(),
            info.product_id(),
            info.product_string().unwrap_or("?"),
            info.path()
        );
        let Ok(dev) = info.open_device(&api) else {
            println!("  open failed");
            continue;
        };

        // 1. VIA 协议版本
        let ver = xfer(&dev, &[0x01], "  via_protocol_version");
        let version = ver.map(|b| u16::from_be_bytes([b[1], b[2]])).unwrap_or(0);
        println!("  => protocol version {version}");

        // 2. Pro 固件探测(我们的 0xC2 查询;原厂固件应回 0xFF unhandled)
        xfer(&dev, &[0xC2], "  pro_query");

        if version >= 12 {
            // VIA3:custom_get_value [0x08, channel, value_id]
            xfer(&dev, &[0x08, 2, 1], "  v3 rgblight brightness (ch2)");
            xfer(&dev, &[0x08, 2, 4], "  v3 rgblight color (ch2)");
            xfer(&dev, &[0x08, 3, 1], "  v3 rgb_matrix brightness (ch3)");
        } else {
            // VIA2:lighting_get_value [0x08, value_id]
            xfer(&dev, &[0x08, 0x80], "  v2 rgblight brightness (0x80)");
            xfer(&dev, &[0x08, 0x81], "  v2 rgblight effect (0x81)");
            xfer(&dev, &[0x08, 0x83], "  v2 rgblight color (0x83)");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    if !found {
        println!("no raw-hid (0xFF60/0x61) device found");
    }
}
