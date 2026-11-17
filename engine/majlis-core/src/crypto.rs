// Session packets, exactly as app/src/main/seal.js does them:
//   [0x10][sid u32][counter u64][AES-256-GCM(body)][tag 16]
//   nonce = direction u32 | counter u64, AAD = the 13-byte header.
// AES-NI and carry-less multiply are picked up at runtime by the aes / ghash crates.
use aes_gcm::aead::{AeadInPlace, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce, Tag};

pub const HDR: usize = 13;
pub const TAG: usize = 16;
pub const T_DATA: u8 = 0x10;

pub struct Cipher { tx: Aes256Gcm, rx: Aes256Gcm, tx_dir: u32, rx_dir: u32, pub sid: u32 }

impl Cipher {
    pub fn new(tx_key: &[u8], rx_key: &[u8], tx_dir: u32, rx_dir: u32, sid: u32) -> Cipher {
        Cipher { tx: Aes256Gcm::new_from_slice(tx_key).unwrap(), rx: Aes256Gcm::new_from_slice(rx_key).unwrap(), tx_dir, rx_dir, sid }
    }

    pub fn tx_dir(&self) -> u32 { self.tx_dir }

    pub fn seal(&self, ctr: u64, body: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(HDR + body.len() + TAG);
        out.push(T_DATA);
        out.extend_from_slice(&self.sid.to_be_bytes());
        out.extend_from_slice(&ctr.to_be_bytes());
        out.extend_from_slice(body);
        let mut nonce = [0u8; 12];
        nonce[0..4].copy_from_slice(&self.tx_dir.to_be_bytes());
        nonce[4..12].copy_from_slice(&ctr.to_be_bytes());
        let (head, rest) = out.split_at_mut(HDR);
        let tag = self.tx.encrypt_in_place_detached(Nonce::from_slice(&nonce), head, rest).expect("seal");
        out.extend_from_slice(&tag);
        out
    }

    // -> (counter, body) if it's genuine (replay is the caller's business)
    pub fn open(&self, pkt: &[u8]) -> Option<(u64, Vec<u8>)> {
        if pkt.len() < HDR + TAG || pkt[0] != T_DATA { return None; }
        let ctr = u64::from_be_bytes(pkt[5..13].try_into().ok()?);
        let mut nonce = [0u8; 12];
        nonce[0..4].copy_from_slice(&self.rx_dir.to_be_bytes());
        nonce[4..12].copy_from_slice(&ctr.to_be_bytes());
        let mut body = pkt[HDR..pkt.len() - TAG].to_vec();
        let tag = Tag::from_slice(&pkt[pkt.len() - TAG..]);
        self.rx.decrypt_in_place_detached(Nonce::from_slice(&nonce), &pkt[..HDR], &mut body, tag).ok()?;
        Some((ctr, body))
    }
}

// The same 2048-wide sliding window as seal.js
pub struct Replay { max: i64, bits: [u32; 64] }
impl Replay {
    pub fn new() -> Replay { Replay { max: -1, bits: [0; 64] } }
    fn pos(c: i64) -> (usize, u32) { let p = (c.rem_euclid(2048)) as usize; (p >> 5, 1 << (p & 31)) }
    pub fn check(&mut self, c: u64) -> bool {
        let c = c as i64;
        const W: i64 = 2048;
        if c > self.max {
            let shift = if self.max < 0 { W } else { c - self.max };
            if shift >= W { self.bits = [0; 64]; } else { for i in self.max + 1..=c { let (w, b) = Self::pos(i); self.bits[w] &= !b; } }
            self.max = c;
            let (w, b) = Self::pos(c); self.bits[w] |= b;
            return true;
        }
        if self.max - c >= W { return false; }
        let (w, b) = Self::pos(c);
        if self.bits[w] & b != 0 { return false; }
        self.bits[w] |= b;
        true
    }
}
