// UDP sockets owned by Rust. A receive thread per socket: packets for a session we hold keys
// for are opened right here (decrypt, video reassembly, feedback) and never cost JavaScript
// a call; everything else (signaling, STUN/TURN control, probes) goes up to JS untouched.
// TURN ChannelData from a bound channel is unwrapped here too, so relayed video stays native.
use crate::link::{From, Link};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, ErrorStrategy};
use std::collections::HashMap;
use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, OnceLock, RwLock};

pub struct RawMsg { pub data: Vec<u8>, pub from: SocketAddr }

pub struct Sock {
    pub id: u32,
    pub udp: UdpSocket,
    // (TURN server, channel) -> (peer, turn index the JS side gave it)
    pub chans: RwLock<HashMap<(SocketAddr, u16), (SocketAddr, u32)>>,
    pub closed: AtomicBool,
}

pub fn socks() -> &'static RwLock<HashMap<u32, Arc<Sock>>> { static S: OnceLock<RwLock<HashMap<u32, Arc<Sock>>>> = OnceLock::new(); S.get_or_init(Default::default) }
// sid -> links (two in one process when a test runs host and guest side by side; the right
// one is whichever key opens the packet)
pub fn links() -> &'static RwLock<HashMap<u32, Vec<Arc<Link>>>> { static L: OnceLock<RwLock<HashMap<u32, Vec<Arc<Link>>>>> = OnceLock::new(); L.get_or_init(Default::default) }
static NEXT: AtomicU32 = AtomicU32::new(1);

// Windows reports an ICMP "port unreachable" as an error on the *next* recv of a UDP socket,
// which would kill a receive loop for nothing: turn that off.
fn no_connreset(s: &UdpSocket) {
    use std::os::windows::io::AsRawSocket;
    use windows::Win32::Networking::WinSock::*;
    let mut off: u32 = 0;
    let mut ret = 0u32;
    const SIO_UDP_CONNRESET: u32 = 0x9800000C;
    unsafe {
        let _ = WSAIoctl(SOCKET(s.as_raw_socket() as usize), SIO_UDP_CONNRESET, Some(&mut off as *mut _ as _), 4, None, 0, &mut ret, None, None);
    }
}

pub fn open(v6: bool, port: u16, cb: ThreadsafeFunction<RawMsg, ErrorStrategy::Fatal>) -> std::io::Result<Arc<Sock>> {
    use socket2::{Domain, Protocol, Socket, Type};
    let s = Socket::new(if v6 { Domain::IPV6 } else { Domain::IPV4 }, Type::DGRAM, Some(Protocol::UDP))?;
    if v6 { s.set_only_v6(true)?; }
    let _ = s.set_recv_buffer_size(8 << 20);
    let _ = s.set_send_buffer_size(4 << 20);
    let addr: SocketAddr = if v6 { format!("[::]:{port}").parse().unwrap() } else { format!("0.0.0.0:{port}").parse().unwrap() };
    s.bind(&addr.into())?;
    let udp: UdpSocket = s.into();
    no_connreset(&udp);
    let sock = Arc::new(Sock { id: NEXT.fetch_add(1, Ordering::Relaxed), udp, chans: RwLock::new(HashMap::new()), closed: AtomicBool::new(false) });
    socks().write().unwrap().insert(sock.id, sock.clone());
    let s2 = sock.clone();
    std::thread::Builder::new().name("majlis-rx".into()).spawn(move || {
        unsafe { use windows::Win32::System::Threading::*; let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL); }
        let mut buf = vec![0u8; 65536];
        while !s2.closed.load(Ordering::Relaxed) {
            match s2.udp.recv_from(&mut buf) {
                Ok((n, from)) => dispatch(&s2, &buf[..n], from, &cb),
                Err(_) => { if s2.closed.load(Ordering::Relaxed) { break; } std::thread::sleep(std::time::Duration::from_millis(1)); }
            }
        }
    })?;
    Ok(sock)
}

fn session(buf: &[u8]) -> Option<Vec<Arc<Link>>> {
    if buf.len() < 29 || buf[0] != crate::crypto::T_DATA { return None; }
    let sid = u32::from_be_bytes(buf[1..5].try_into().ok()?);
    links().read().unwrap().get(&sid).cloned()
}

fn deliver(list: Vec<Arc<Link>>, pkt: &[u8], from: From) -> bool { list.iter().any(|l| l.on_packet(pkt, from)) }

fn dispatch(s: &Arc<Sock>, buf: &[u8], from: SocketAddr, cb: &ThreadsafeFunction<RawMsg, ErrorStrategy::Fatal>) {
    if let Some(l) = session(buf) { if deliver(l, buf, From::Udp { sock: s.id, addr: from }) { return; } }
    if buf.len() >= 4 && (0x40..=0x7f).contains(&buf[0]) {
        let ch = u16::from_be_bytes([buf[0], buf[1]]);
        let len = u16::from_be_bytes([buf[2], buf[3]]) as usize;
        if let Some(&(peer, tidx)) = s.chans.read().unwrap().get(&(from, ch)) {
            if 4 + len <= buf.len() {
                let inner = &buf[4..4 + len];
                if let Some(l) = session(inner) { if deliver(l, inner, From::Turn { sock: s.id, peer, turn: tidx }) { return; } }
            }
        }
    }
    cb.call(RawMsg { data: buf.to_vec(), from }, ThreadsafeFunctionCallMode::NonBlocking);
}

pub fn close(id: u32) {
    if let Some(s) = socks().write().unwrap().remove(&id) {
        s.closed.store(true, Ordering::Relaxed);
        // wake the receive loop
        if let Ok(a) = s.udp.local_addr() {
            let to: SocketAddr = if a.is_ipv6() { format!("[::1]:{}", a.port()).parse().unwrap() } else { format!("127.0.0.1:{}", a.port()).parse().unwrap() };
            let _ = s.udp.send_to(&[0], to);
        }
    }
}
