# Convention: package cho module TypeScript

> Trạng thái: **Chờ Đinh Đức Thuận duyệt**
> Áp dụng: mọi module TypeScript dưới `src/` từ Phase 1, cho tới và sau khi `P1-T02` gộp workspace chung.
> Không áp dụng: `src/bots/**` (Python, không dùng `package.json`).

Mục tiêu: mỗi module tự cài đặt, typecheck, test và build độc lập trên localhost; khi `P1-T02` gộp workspace thì **không phải sửa source hoặc câu lệnh import**.

## 1. Quy tắc bắt buộc

1. Mỗi module có đúng một bộ manifest tại thư mục module:

   | File | Commit? | Ghi chú |
   | --- | --- | --- |
   | `package.json` | Có | Theo mẫu mục 3 |
   | `package-lock.json` | Có | Sinh bởi `npm install`, không sửa tay |
   | `.npmrc` | Có | Theo mẫu mục 4 |
   | `tsconfig.json` | Có | Typecheck `src` + `tests` |
   | `tsconfig.build.json` | Có | Build chỉ `src`, không chứa test |

   Bộ manifest được tính là **một logical path** khi ước lượng số file của task.

2. Tên package là `@ott/<tên-thư-mục>` theo bảng:

   | Thư mục | Package | Owner tạo manifest |
   | --- | --- | --- |
   | `src/game-core/` | `@ott/game-core` | Long, tại `P1-L01` |
   | `src/bot-protocol/` | `@ott/bot-protocol` | Long, tại `P1-L03` |
   | `src/match-runner/` | `@ott/match-runner` | Đạt, tại `P1-D02` |
   | `src/platform/api/` | `@ott/platform-api` | Phase 2, theo task card |
   | `src/platform/job-contract/` | `@ott/job-contract` | Phase 2, theo task card |
   | `src/platform/worker/` | `@ott/platform-worker` | Phase 2, theo task card |
   | `src/platform/web/` | `@ott/platform-web` | Phase 2, theo task card |

3. Public entrypoint duy nhất là `src/index.ts`, khai báo qua `"exports": { ".": "./src/index.ts" }`. Module khác chỉ import theo tên package; deep import như `@ott/game-core/src/engine.ts` sẽ bị typecheck từ chối.
4. Dùng module khác bằng dependency `file:` (mục 4). Không import đường dẫn tương đối sang module khác, không copy type sang module mình.
5. Mọi module dùng chung `src/tsconfig.base.json` và đúng phiên bản công cụ ở mục 2. Đổi phiên bản phải đổi cho mọi module trong cùng một PR do Thuận duyệt.
6. Module chỉ sửa manifest của chính mình. Sửa `src/tsconfig.base.json` hoặc file ở repository root thuộc phạm vi Thuận.

## 2. Phiên bản đã pin

Pin chính xác (không dùng `^` hoặc `~`) cho công cụ dùng chung:

| Package | Phiên bản | Dùng ở |
| --- | --- | --- |
| `typescript` | `7.0.2` | Mọi module |
| `vitest` | `5.0.3` | Mọi module |
| `@vitest/coverage-v8` | `5.0.3` | Mọi module |
| `@types/node` | `22.20.5` | Mọi module (chỉ là type, không cho phép module vi phạm ranh giới trong `src/README.md`) |
| `tsx` | `4.23.15` | Chỉ module có lệnh chạy trực tiếp (`@ott/match-runner` cho CLI) |

Runtime: Node.js `^22.12.0`. Không dựa vào `node file.ts`: bản Node 22 trên máy dev có thể không có TypeScript strip-types, nên lệnh chạy TS phải qua `tsx`.

Dependency runtime riêng của module (ví dụ validator JSON Schema) do owner module chọn, khai báo trong `dependencies` và ghi lý do trong README module.

## 3. Mẫu `package.json`

```json
{
  "name": "@ott/game-core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": "^22.12.0" },
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage --coverage.include=src",
    "build": "tsc -p tsconfig.build.json"
  },
  "devDependencies": {
    "@types/node": "22.20.5",
    "@vitest/coverage-v8": "5.0.3",
    "typescript": "7.0.2",
    "vitest": "5.0.3"
  }
}
```

Bốn script `typecheck`, `test`, `test:coverage`, `build` là bắt buộc và giữ đúng tên. Script bổ sung (ví dụ `match` của match-runner) chỉ thêm khi task card yêu cầu.

Module phụ thuộc module khác thêm khối `dependencies`, ví dụ `src/match-runner/package.json`:

```json
{
  "dependencies": {
    "@ott/bot-protocol": "file:../bot-protocol",
    "@ott/game-core": "file:../game-core"
  }
}
```

## 4. Liên kết module trước `P1-T02`

`src/<module>/.npmrc`:

```ini
engine-strict=true
install-links=false
```

- `install-links=false` bắt buộc: npm tạo symlink `node_modules/@ott/<x>` trỏ tới source module kia, nên thay đổi của owner được thấy ngay khi chạy test. Thiếu dòng này, npm 9 copy một bản chụp và test sẽ chạy trên code cũ.
- `engine-strict=true` làm `npm ci` dừng nếu sai phiên bản Node.
- Cài module phụ thuộc trước module dùng nó: `game-core` → `bot-protocol` → `match-runner`.
- Khi module được dùng thay đổi `dependencies` của nó, chạy lại `npm --prefix src/<module> install` ở module đó; module dùng nó không cần cài lại.

## 5. TypeScript config

Base dùng chung: [`src/tsconfig.base.json`](../../src/tsconfig.base.json). Mỗi module có hai file:

`tsconfig.json`

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src", "tests"]
}
```

`tsconfig.build.json`

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "declaration": true },
  "include": ["src"]
}
```

Module trong `src/platform/<x>/` dùng `"extends": "../../tsconfig.base.json"`.

Quy tắc code đi kèm base config:

- ESM; import tương đối trong module ghi rõ đuôi `.ts`: `import { createGame } from "./engine.ts";`. Build tự đổi thành `.js`.
- Import type dùng `import type` hoặc `type` inline: `import { createGame, type GameState } from "@ott/game-core";`.
- Không dùng `enum`, `namespace` hoặc parameter property; dùng union literal như contract (`'X' | 'O'`).

## 6. Layout module

```text
src/<module>/
├── package.json
├── package-lock.json
├── .npmrc
├── tsconfig.json
├── tsconfig.build.json
├── README.md
├── src/
│   └── index.ts        # public entrypoint duy nhất
└── tests/
    └── *.test.ts       # Vitest tự tìm, không cần vitest.config.ts
```

`node_modules/`, `dist/` và `coverage/` không được commit (root `.gitignore`).

## 7. Lệnh dùng chung

Chạy từ repository root, thay `<module>` bằng tên thư mục:

```bash
npm --prefix src/<module> ci
npm --prefix src/<module> run typecheck
npm --prefix src/<module> test
npm --prefix src/<module> test -- tests/<file>.test.ts
npm --prefix src/<module> run test:coverage
npm --prefix src/<module> run build
```

Đường dẫn test trong lệnh là tương đối với thư mục module. Verification của task card trước `P1-T02` dùng đúng mẫu này.

## 8. Khi `P1-T02` gộp workspace

Thuận thực hiện, owner module không cần sửa source:

- Root `package.json` khai báo `workspaces` cho các module ở mục 1 và giữ các script của từng module.
- Đổi `"file:../<x>"` thành `"*"`; xóa `package-lock.json` và `.npmrc` của từng module, dùng lockfile root.
- Chuyển phiên bản pin ở mục 2 lên root nếu cần; câu lệnh `import` và `exports` giữ nguyên.
- Cập nhật mục 4, 7 và 8 của tài liệu này trong cùng PR.

## 9. Checklist cho AI khi tạo hoặc sửa manifest

- [ ] Tên package và thư mục khớp bảng mục 1.
- [ ] Đủ năm file manifest; `.npmrc` có `install-links=false`.
- [ ] Phiên bản công cụ khớp mục 2, pin chính xác.
- [ ] Chỉ import module khác qua tên package đã khai báo trong `dependencies`.
- [ ] `npm --prefix src/<module> ci && npm --prefix src/<module> run typecheck && npm --prefix src/<module> test && npm --prefix src/<module> run build` pass.
- [ ] `node_modules/`, `dist/`, `coverage/` không có trong diff.
