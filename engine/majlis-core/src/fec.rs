// Reed-Solomon erasure coding over GF(2^8) (poly 0x11d) with a Cauchy matrix: byte for byte
// the same as app/src/main/fec.js. Parity row i for data column j is inv((k+i) ^ j), so extra
// rows (NACK repairs) are just more rows: any k of all the shards rebuild the frame.
// The multiply-add runs on AVX2 (two 16-entry nibble tables + pshufb) when the CPU has it.
use std::sync::OnceLock;

struct Tables { exp: [u8; 512], log: [u8; 256], mul_lo: Vec<[u8; 16]>, mul_hi: Vec<[u8; 16]>, full: Vec<[u8; 256]> }

fn t() -> &'static Tables {
    static T: OnceLock<Tables> = OnceLock::new();
    T.get_or_init(|| {
        let mut exp = [0u8; 512];
        let mut log = [0u8; 256];
        let mut x: u32 = 1;
        for i in 0..255 {
            exp[i] = x as u8;
            log[x as usize] = i as u8;
            x <<= 1;
            if x & 0x100 != 0 { x ^= 0x11d; }
        }
        for i in 255..512 { exp[i] = exp[i - 255]; }
        let mul = |a: u8, b: u8| if a == 0 || b == 0 { 0 } else { exp[log[a as usize] as usize + log[b as usize] as usize] };
        let mut mul_lo = vec![[0u8; 16]; 256];
        let mut mul_hi = vec![[0u8; 16]; 256];
        let mut full = vec![[0u8; 256]; 256];
        for c in 0..256usize {
            for n in 0..16u8 { mul_lo[c][n as usize] = mul(c as u8, n); mul_hi[c][n as usize] = mul(c as u8, n << 4); }
            for v in 0..256usize { full[c][v] = mul(c as u8, v as u8); }
        }
        Tables { exp, log, mul_lo, mul_hi, full }
    })
}

#[inline]
fn inv(a: u8) -> u8 { let t = t(); t.exp[255 - t.log[a as usize] as usize] }
#[inline]
fn mul(a: u8, b: u8) -> u8 { if a == 0 || b == 0 { 0 } else { let t = t(); t.exp[t.log[a as usize] as usize + t.log[b as usize] as usize] } }
#[inline]
pub fn coef(k: usize, i: usize, j: usize) -> u8 { inv(((k + i) ^ j) as u8) }

// dst ^= c * src
pub fn add_mul(dst: &mut [u8], src: &[u8], c: u8) {
    if c == 0 { return; }
    let n = dst.len().min(src.len());
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx2") {
            let done = unsafe { add_mul_avx2(&mut dst[..n], &src[..n], c) };
            let tb = &t().full[c as usize];
            for i in done..n { dst[i] ^= tb[src[i] as usize]; }
            return;
        }
    }
    let tb = &t().full[c as usize];
    for i in 0..n { dst[i] ^= tb[src[i] as usize]; }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn add_mul_avx2(dst: &mut [u8], src: &[u8], c: u8) -> usize {
    use std::arch::x86_64::*;
    let tb = t();
    let lo = _mm_loadu_si128(tb.mul_lo[c as usize].as_ptr() as *const __m128i);
    let hi = _mm_loadu_si128(tb.mul_hi[c as usize].as_ptr() as *const __m128i);
    let lo = _mm256_broadcastsi128_si256(lo);
    let hi = _mm256_broadcastsi128_si256(hi);
    let mask = _mm256_set1_epi8(0x0f);
    let n = dst.len() / 32 * 32;
    let mut i = 0;
    while i < n {
        let s = _mm256_loadu_si256(src.as_ptr().add(i) as *const __m256i);
        let d = _mm256_loadu_si256(dst.as_ptr().add(i) as *const __m256i);
        let l = _mm256_shuffle_epi8(lo, _mm256_and_si256(s, mask));
        let h = _mm256_shuffle_epi8(hi, _mm256_and_si256(_mm256_srli_epi64(s, 4), mask));
        let r = _mm256_xor_si256(d, _mm256_xor_si256(l, h));
        _mm256_storeu_si256(dst.as_mut_ptr().add(i) as *mut __m256i, r);
        i += 32;
    }
    n
}

// parity rows from..from+count for k equal-length data shards
pub fn parity(data: &[&[u8]], from: usize, count: usize) -> Vec<Vec<u8>> {
    let k = data.len();
    let len = data[0].len();
    (from..from + count).map(|i| {
        let mut p = vec![0u8; len];
        for (j, d) in data.iter().enumerate() { add_mul(&mut p, d, coef(k, i, j)); }
        p
    }).collect()
}

// shards: index -> data (index < k data, >= k parity row index-k). Returns the k data shards.
pub fn decode(shards: &[(usize, &[u8])], k: usize) -> Option<Vec<Vec<u8>>> {
    if shards.len() < k { return None; }
    let len = shards[0].1.len();
    let mut out: Vec<Option<Vec<u8>>> = vec![None; k];
    for (i, s) in shards { if *i < k { out[*i] = Some(s.to_vec()); } }
    let missing: Vec<usize> = (0..k).filter(|j| out[*j].is_none()).collect();
    if missing.is_empty() { return Some(out.into_iter().map(|x| x.unwrap()).collect()); }
    // the first k shards we have; data ones first (cheap rows), then parity
    let mut have: Vec<(usize, &[u8])> = shards.iter().filter(|(i, _)| *i < k).cloned().collect();
    for s in shards.iter().filter(|(i, _)| *i >= k) { if have.len() >= k { break; } have.push(*s); }
    if have.len() < k { return None; }
    have.truncate(k);
    // invert the k x k generator rows we have
    let n = k;
    let mut a: Vec<Vec<u8>> = have.iter().map(|(idx, _)| {
        let mut r = vec![0u8; n];
        if *idx < k { r[*idx] = 1; } else { for j in 0..k { r[j] = coef(k, idx - k, j); } }
        r
    }).collect();
    let mut b: Vec<Vec<u8>> = (0..n).map(|i| { let mut r = vec![0u8; n]; r[i] = 1; r }).collect();
    for c in 0..n {
        let mut p = c;
        while p < n && a[p][c] == 0 { p += 1; }
        if p == n { return None; }
        a.swap(c, p); b.swap(c, p);
        let iv = inv(a[c][c]);
        for x in 0..n { a[c][x] = mul(iv, a[c][x]); b[c][x] = mul(iv, b[c][x]); }
        for r in 0..n {
            if r == c || a[r][c] == 0 { continue; }
            let f = a[r][c];
            for x in 0..n { let (ac, bc) = (a[c][x], b[c][x]); a[r][x] ^= mul(f, ac); b[r][x] ^= mul(f, bc); }
        }
    }
    for &j in &missing {
        let mut d = vec![0u8; len];
        for t in 0..n { add_mul(&mut d, have[t].1, b[j][t]); }
        out[j] = Some(d);
    }
    Some(out.into_iter().map(|x| x.unwrap()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_with_losses() {
        let k = 20;
        let data: Vec<Vec<u8>> = (0..k).map(|i| (0..1100).map(|x| ((x * 7 + i * 13) % 251) as u8).collect()).collect();
        let refs: Vec<&[u8]> = data.iter().map(|d| d.as_slice()).collect();
        let par = parity(&refs, 0, 6);
        let extra = parity(&refs, 6, 2); // a NACK repair: more rows
        let mut sh: Vec<(usize, &[u8])> = vec![];
        for (i, d) in data.iter().enumerate() { if i % 3 != 0 { sh.push((i, d)); } } // lose 7
        for (i, p) in par.iter().enumerate() { sh.push((k + i, p)); }
        for (i, p) in extra.iter().enumerate() { sh.push((k + 6 + i, p)); }
        let out = decode(&sh, k).unwrap();
        assert_eq!(out, data);
    }
}
