//! Raw HID 通信线程:设备发现/重连、发包、收固件状态回报。
//! 报文规范见 docs/protocol.md。

use collector::packet::{
    build_query_packet, build_set_state_packet, CMD_STATE, PACKET_LEN,
};
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

pub const USAGE_PAGE: u16 = 0xFF60;
pub const USAGE: u16 = 0x61;

pub enum Cmd {
    /// 推送数据包(缓存,重连后自动补发)
    Send([u8; PACKET_LEN]),
    SetState { mode: Option<u8>, source: Option<u8> },
}

pub enum Event {
    Connected(Option<String>),
    Disconnected,
    /// 固件状态回报 (mode, source)
    State(u8, u8),
}

pub fn spawn(rx: Receiver<Cmd>, on_event: impl Fn(Event) + Send + 'static) {
    std::thread::Builder::new()
        .name("hid".into())
        .spawn(move || run(rx, on_event))
        .expect("spawn hid thread");
}

fn find_device(api: &hidapi::HidApi) -> Option<(hidapi::HidDevice, Option<String>)> {
    for info in api.device_list() {
        if info.usage_page() == USAGE_PAGE && info.usage() == USAGE {
            if let Ok(dev) = info.open_device(api) {
                let name = info.product_string().map(str::to_owned);
                return Some((dev, name));
            }
        }
    }
    None
}

/// QMK Raw HID 无 report id,macOS 上 hidapi 要求首字节补 0x00。
fn write_packet(dev: &hidapi::HidDevice, pkt: &[u8; PACKET_LEN]) -> bool {
    let mut buf = [0u8; PACKET_LEN + 1];
    buf[1..].copy_from_slice(pkt);
    dev.write(&buf).is_ok()
}

fn run(rx: Receiver<Cmd>, on_event: impl Fn(Event)) {
    let mut api: Option<hidapi::HidApi> = None;
    let mut dev: Option<hidapi::HidDevice> = None;
    let mut last_scan = Instant::now() - Duration::from_secs(60);
    let mut last_data: Option<[u8; PACKET_LEN]> = None;

    loop {
        if dev.is_none() && last_scan.elapsed() >= Duration::from_secs(3) {
            last_scan = Instant::now();
            match api.as_mut() {
                Some(a) => {
                    let _ = a.refresh_devices();
                }
                None => api = hidapi::HidApi::new().ok(),
            }
            if let Some(a) = &api {
                if let Some((d, name)) = find_device(a) {
                    // 连上后先同步固件状态,再补发最近的数据包
                    let ok = write_packet(&d, &build_query_packet())
                        && last_data.map_or(true, |p| write_packet(&d, &p));
                    if ok {
                        dev = Some(d);
                        on_event(Event::Connected(name));
                    }
                }
            }
        }

        let mut drop_dev = false;
        while let Ok(cmd) = rx.try_recv() {
            let pkt = match cmd {
                Cmd::Send(p) => {
                    last_data = Some(p);
                    p
                }
                Cmd::SetState { mode, source } => build_set_state_packet(mode, source),
            };
            if let Some(d) = &dev {
                if !write_packet(d, &pkt) {
                    drop_dev = true;
                }
            }
        }

        // 收固件回报;read_timeout 同时兼作循环节拍
        if let Some(d) = &dev {
            if !drop_dev {
                let mut buf = [0u8; PACKET_LEN];
                match d.read_timeout(&mut buf, 200) {
                    Ok(n) if n > 0 && buf[0] == CMD_STATE => {
                        on_event(Event::State(buf[1], buf[2]))
                    }
                    Ok(_) => {}
                    Err(_) => drop_dev = true,
                }
            }
        } else {
            std::thread::sleep(Duration::from_millis(200));
        }

        if drop_dev {
            dev = None;
            on_event(Event::Disconnected);
        }
    }
}
