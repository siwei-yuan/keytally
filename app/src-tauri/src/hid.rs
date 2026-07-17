//! Raw HID 通信线程。
//!
//! 连接时自动探测后端:
//! - **Pro**:刷了本项目固件的键盘(响应 0xC2 查询)→ 逐灯协议,见 docs/protocol.md
//! - **VIA**:任何 VIA 键盘(V2/V3,rgblight 或 rgb_matrix)→ 整板颜色控制,
//!   接管前读取原灯效设置,空闲/退出时恢复;写入不落 EEPROM,键盘重启即还原。

use collector::packet::{build_query_packet, build_set_state_packet, CMD_STATE, PACKET_LEN};
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

pub const USAGE_PAGE: u16 = 0xFF60;
pub const USAGE: u16 = 0x61;

/// 通用模式下的目标灯效(由 lib.rs 从 snapshot+模式+数据源算出)
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct ViaLook {
    pub hue: u8, // QMK 0-255 色环
    pub sat: u8,
    pub blink_warn: bool,  // 1Hz 红色告警闪烁
    pub breathing: bool,   // 2.2s 呼吸
    pub passthrough: bool, // 不接管,显示用户自己的灯效
}

#[derive(Debug, Clone, Copy, Default)]
pub struct Frame {
    pub pro: [u8; PACKET_LEN],
    pub via: ViaLook,
}

pub enum Cmd {
    Frame(Frame),
    /// 仅 Pro 后端有键盘侧状态;VIA 后端忽略
    SetState { mode: Option<u8>, source: Option<u8> },
    /// 恢复灯效并结束线程(app 退出前调用)
    Shutdown,
}

pub enum Event {
    Connected { name: Option<String>, backend: &'static str, lighting: &'static str, vid: u16, pid: u16 },
    Disconnected,
    /// Pro 固件状态回报 (mode, source)
    State(u8, u8),
}

#[derive(Clone, Copy)]
struct SavedLighting {
    brightness: u8,
    effect: u8,
    speed: u8,
    color: (u8, u8),
}

#[derive(Clone, Copy)]
enum Backend {
    Pro,
    /// v3: 走 custom channel(rgblight=2 / rgb_matrix=3);v2: channel 无意义
    Via { v3: bool, channel: u8, saved: SavedLighting },
}

pub fn spawn(rx: Receiver<Cmd>, on_event: impl Fn(Event) + Send + 'static) {
    std::thread::Builder::new()
        .name("hid".into())
        .spawn(move || run(rx, on_event))
        .expect("spawn hid thread");
}

fn write_packet(dev: &hidapi::HidDevice, pkt: &[u8]) -> bool {
    let mut buf = [0u8; PACKET_LEN + 1];
    buf[1..1 + pkt.len()].copy_from_slice(pkt);
    dev.write(&buf).is_ok()
}

/// 发请求并等待回显匹配的响应(跳过无关帧)
fn xfer(dev: &hidapi::HidDevice, req: &[u8], match_len: usize) -> Option<[u8; PACKET_LEN]> {
    if !write_packet(dev, req) {
        return None;
    }
    for _ in 0..10 {
        let mut buf = [0u8; PACKET_LEN];
        match dev.read_timeout(&mut buf, 300) {
            Ok(n) if n > 0 => {
                if buf[..match_len] == req[..match_len] {
                    return Some(buf);
                }
                if buf[0] == 0xFF {
                    return Some(buf); // id_unhandled:也算响应,让调用方判断
                }
            }
            _ => return None,
        }
    }
    None
}

fn handled(resp: Option<[u8; PACKET_LEN]>) -> Option<[u8; PACKET_LEN]> {
    resp.filter(|b| b[0] != 0xFF)
}

fn probe(dev: &hidapi::HidDevice) -> Option<Backend> {
    // 1. Pro 固件:0xC2 → 期待 0xC1 状态回报
    if write_packet(dev, &build_query_packet()) {
        let mut buf = [0u8; PACKET_LEN];
        if matches!(dev.read_timeout(&mut buf, 300), Ok(n) if n > 0 && buf[0] == CMD_STATE) {
            return Some(Backend::Pro);
        }
    }
    // 2. VIA 协议版本
    let ver = handled(xfer(dev, &[0x01], 1))?;
    let version = u16::from_be_bytes([ver[1], ver[2]]);
    if version >= 12 {
        // V3:探测 rgblight(ch2)→ rgb_matrix(ch3)
        for ch in [2u8, 3u8] {
            if handled(xfer(dev, &[0x08, ch, 1], 3)).is_some() {
                let get = |vid: u8| handled(xfer(dev, &[0x08, ch, vid], 3));
                let saved = SavedLighting {
                    brightness: get(1).map_or(128, |b| b[3]),
                    effect: get(2).map_or(1, |b| b[3]),
                    speed: get(3).map_or(128, |b| b[3]),
                    color: get(4).map_or((0, 255), |b| (b[3], b[4])),
                };
                return Some(Backend::Via { v3: true, channel: ch, saved });
            }
        }
    } else {
        // V2:rgblight 值域 0x80-0x83
        if handled(xfer(dev, &[0x08, 0x80], 2)).is_some() {
            let get = |vid: u8| handled(xfer(dev, &[0x08, vid], 2));
            let saved = SavedLighting {
                brightness: get(0x80).map_or(128, |b| b[2]),
                effect: get(0x81).map_or(1, |b| b[2]),
                speed: get(0x82).map_or(128, |b| b[2]),
                color: get(0x83).map_or((0, 255), |b| (b[2], b[3])),
            };
            return Some(Backend::Via { v3: false, channel: 0, saved });
        }
    }
    None
}

// ---- VIA 灯光写入(不带 save,断电/重启即还原) ----

fn via_set(dev: &hidapi::HidDevice, be: &Backend, value_id_v3: u8, value_id_v2: u8, data: &[u8]) {
    if let Backend::Via { v3, channel, .. } = be {
        let mut req = Vec::with_capacity(6);
        req.push(0x07);
        if *v3 {
            req.push(*channel);
            req.push(value_id_v3);
        } else {
            req.push(value_id_v2);
        }
        req.extend_from_slice(data);
        let _ = write_packet(dev, &req);
    }
}

fn via_apply(dev: &hidapi::HidDevice, be: &Backend, h: u8, s: u8, v: u8) {
    via_set(dev, be, 2, 0x81, &[1]); // effect = solid color
    via_set(dev, be, 1, 0x80, &[v]);
    via_set(dev, be, 4, 0x83, &[h, s]);
}

fn via_restore(dev: &hidapi::HidDevice, be: &Backend) {
    if let Backend::Via { saved, .. } = be {
        via_set(dev, be, 2, 0x81, &[saved.effect]);
        via_set(dev, be, 3, 0x82, &[saved.speed]);
        via_set(dev, be, 1, 0x80, &[saved.brightness]);
        via_set(dev, be, 4, 0x83, &[saved.color.0, saved.color.1]);
    }
}

/// 2.2s 三角波(45%-100%),与 Pro 固件呼吸一致
fn breathe_scale(t_ms: u128) -> u32 {
    let t = (t_ms % 2200) as u32;
    let phase = if t < 1100 { t } else { 2200 - t };
    115 + phase * 140 / 1100
}

fn find_device(api: &hidapi::HidApi) -> Option<(hidapi::HidDevice, Option<String>, u16, u16)> {
    for info in api.device_list() {
        if info.usage_page() == USAGE_PAGE && info.usage() == USAGE {
            if let Ok(dev) = info.open_device(api) {
                return Some((dev, info.product_string().map(str::to_owned), info.vendor_id(), info.product_id()));
            }
        }
    }
    None
}

fn run(rx: Receiver<Cmd>, on_event: impl Fn(Event)) {
    let mut api: Option<hidapi::HidApi> = None;
    let mut conn: Option<(hidapi::HidDevice, Backend)> = None;
    let mut last_scan = Instant::now() - Duration::from_secs(60);
    let mut frame: Option<Frame> = None;
    let mut taken_over = false; // VIA 后端:当前是否接管着灯效
    let mut last_applied: Option<(u8, u8, u8)> = None;
    let start = Instant::now();

    loop {
        // ---- 连接 ----
        if conn.is_none() && last_scan.elapsed() >= Duration::from_secs(3) {
            last_scan = Instant::now();
            match api.as_mut() {
                Some(a) => {
                    let _ = a.refresh_devices();
                }
                None => api = hidapi::HidApi::new().ok(),
            }
            if let Some(a) = &api {
                if let Some((dev, name, vid, pid)) = find_device(a) {
                    if let Some(be) = probe(&dev) {
                        let (backend, lighting) = match be {
                            Backend::Pro => ("pro", "per-led"),
                            Backend::Via { v3: true, channel: 3, .. } => ("via", "rgb_matrix"),
                            Backend::Via { .. } => ("via", "rgblight"),
                        };
                        if matches!(be, Backend::Pro) {
                            if let Some(f) = &frame {
                                let _ = write_packet(&dev, &f.pro);
                            }
                        }
                        taken_over = false;
                        last_applied = None;
                        conn = Some((dev, be));
                        on_event(Event::Connected { name, backend, lighting, vid, pid });
                    }
                }
            }
        }

        // ---- 命令 ----
        let mut drop_dev = false;
        let mut shutdown = false;
        while let Ok(cmd) = rx.try_recv() {
            match cmd {
                Cmd::Frame(f) => {
                    let changed_pro = frame.map_or(true, |old| old.pro != f.pro);
                    frame = Some(f);
                    if changed_pro {
                        if let Some((dev, Backend::Pro)) = &conn {
                            if !write_packet(dev, &f.pro) {
                                drop_dev = true;
                            }
                        }
                    }
                }
                Cmd::SetState { mode, source } => {
                    if let Some((dev, Backend::Pro)) = &conn {
                        if !write_packet(dev, &build_set_state_packet(mode, source)) {
                            drop_dev = true;
                        }
                    }
                }
                Cmd::Shutdown => shutdown = true,
            }
        }
        if shutdown {
            if let Some((dev, be)) = &conn {
                if taken_over {
                    via_restore(dev, be);
                }
            }
            return;
        }

        // ---- VIA 后端渲染 tick ----
        if let (Some((dev, be @ Backend::Via { .. })), Some(f)) = (&conn, &frame) {
            let look = f.via;
            if look.passthrough {
                if taken_over {
                    via_restore(dev, be);
                    taken_over = false;
                    last_applied = None;
                }
            } else {
                let saved_v = match be {
                    Backend::Via { saved, .. } => saved.brightness.max(60),
                    _ => 128,
                };
                let t = start.elapsed().as_millis();
                let (mut h, mut s) = (look.hue, look.sat);
                let mut v = saved_v as u32;
                if look.breathing {
                    v = v * breathe_scale(t) / 255;
                }
                if look.blink_warn && (t % 1000) < 500 {
                    h = 0;
                    s = 255;
                }
                let hsv = (h, s, v.min(255) as u8);
                if !taken_over || last_applied != Some(hsv) {
                    via_apply(dev, be, hsv.0, hsv.1, hsv.2);
                    taken_over = true;
                    last_applied = Some(hsv);
                }
            }
        }

        // ---- 读回报 / 断线检测 ----
        if let Some((dev, be)) = &conn {
            if !drop_dev {
                let mut buf = [0u8; PACKET_LEN];
                let timeout = if matches!(be, Backend::Via { .. }) { 100 } else { 200 };
                match dev.read_timeout(&mut buf, timeout) {
                    Ok(n) if n > 0 && buf[0] == CMD_STATE && matches!(be, Backend::Pro) => {
                        on_event(Event::State(buf[1], buf[2]));
                    }
                    Ok(_) => {}
                    Err(_) => drop_dev = true,
                }
            }
        } else {
            std::thread::sleep(Duration::from_millis(200));
        }

        if drop_dev {
            conn = None;
            taken_over = false;
            last_applied = None;
            on_event(Event::Disconnected);
        }
    }
}
