# ADR-0010: Finals 8 đội và ResultBundle có chữ ký

## Status

Accepted

## Date

2026-10-14

## Context

BTC cần chung kết offline đơn giản, không phụ thuộc Internet, nhưng public web phải hiển thị kết quả đáng
tin cậy. Game có thể thay đổi nên tie-break không được gắn cứng vào UI/tournament service.

## Decision

- Finals có 8 đội, không vòng bảng, single-elimination BO3; bronze match cấu hình được và mặc định bật.
- Qualification seed là thứ tự toàn phần: Elo, số series thắng, hiệu số điểm game, head-to-head khi đúng
  hai đội hòa, cuối cùng bốc thăm deterministic bằng seed commit/public.
- Game adapter versioned trả winner hoặc ordered `scoreBreakdown`; qualification seed là fallback cuối.
- `FinalsRuleSet` pin `maxTurns`, total wall-clock cap, map/side/timing/scoring adapter. Default PoC là
  200 lượt/game và 30 phút/cặp; BTC có thể đổi trước khi lock.
- LAN export `ResultBundle` với manifest RFC 8785, SHA-256 từng artifact và chữ ký Ed25519. Private key ở
  phía offline; online importer chỉ giữ public key và verify all-or-nothing.
- PoC cho phép transfer thủ công và test key; public UI hiển thị bundle/key/checksum/import time/`VERIFIED`.

## Alternatives considered

### Vòng bảng trước knockout

Không chọn vì BTC đã chốt không có vòng bảng và cần lịch vận hành gọn.

### Đồng bộ LAN và online bằng shared database

Không chọn vì phá ranh giới offline và biến sự cố Internet thành dependency của finals.

### HMAC dùng chung cho ResultBundle

Không chọn vì online verifier sẽ phải giữ secret có khả năng ký giả; chữ ký bất đối xứng phù hợp hơn.

## Consequences

- Finals domain/UI theo [Finals Format v1](../contracts/finals-format-v1.md).
- Export/import theo [Finals ResultBundle v1](../contracts/finals-result-bundle-v1.md).
- HSM, automated rotation và HA nằm ngoài PoC; production hóa phải có ADR/runbook bổ sung.
