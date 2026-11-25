# S Clean

Ứng dụng dọn dẹp macOS của **Socin.org**: dọn rác, tìm file lớn, phân loại ảnh/video có xem thumbnail, tìm file trùng và ứng dụng trùng.

© 2026 Socin.org. Bảo lưu mọi quyền (xem `LICENSE`).

## Tính năng

| Màn hình | Làm gì |
|---|---|
| Tổng quan | Quét tất cả, hiện dung lượng có thể giải phóng, nút "Dọn an toàn ngay" |
| Bản đồ dung lượng | Đo **mọi thứ** dưới thư mục nhà, toàn ổ đĩa hoặc một thư mục: kể cả file ẩn (dấu chấm), `~/Library`, bên trong gói (.photoslibrary, .app, máy ảo). Đi sâu từng thư mục, đánh dấu mục Finder không cho thấy và lý do. "Toàn ổ đĩa" cho biết phần dung lượng chưa giải thích được. Liệt kê thư mục bị macOS chặn đọc |
| Dọn rác | **An toàn (tick sẵn):** cache ứng dụng, log, cache lập trình, tải dở và bản cài macOS, dữ liệu còn sót của app đã gỡ. **Cần xem lại (không tick sẵn):** file .dmg/.pkg/.iso, Xcode Archives và Device Support cũ, sao lưu iPhone/iPad, `node_modules` cũ, cache trình duyệt và ứng dụng Electron (Chrome, Notion, Slack, Discord… bỏ qua app đang mở), dữ liệu AI cục bộ (Ollama, Hugging Face, LM Studio), tệp đính kèm Mail, Thùng rác |
| File lớn và cũ | File trên 50 MB đến 1 GB, lọc theo loại và thời gian chưa mở, xem trước bằng Quick Look |
| Ảnh và video | Phân nhóm: video lớn, quay màn hình, ảnh chụp màn hình, ảnh giống nhau (so sánh dHash), cũ chưa mở. Bấm vào ô để xem thumbnail lớn trước khi xóa |
| File trùng | So kích thước, rồi hash đầu/cuối, rồi SHA-256 toàn bộ. Mặc định giữ bản cũ nhất |
| Ứng dụng trùng | Gom theo Bundle ID và tên "App 2", "App copy", gợi ý giữ bản mới nhất. Bỏ qua app của Apple |
| Lịch sử và an toàn | Mọi thứ đã dọn (thời gian, đường dẫn, dung lượng, cách dọn). Cài đặt xóa hẳn hay vào Thùng rác |
| Dung lượng ẩn | Giải thích phần "Dữ liệu hệ thống" Finder không hiện: các phần của ổ APFS (Dữ liệu, swap, Preboot, macOS), snapshot, bản cập nhật macOS đang chờ, runtime iOS Simulator (xóa được, có hỏi lại), ổ DMG đang gắn (tháo ra), thư mục lớn trong ~/Library kèm gợi ý xử lý, và các vùng cần Full Disk Access (Ảnh, Thùng rác, Tin nhắn, Mail, Safari) |

## An toàn

- Mọi thao tác xóa chỉ áp dụng cho đường dẫn nằm trong kết quả quét gần nhất (kiểm tra ở tiến trình chính).
- File lớn, ảnh/video, file trùng, ứng dụng luôn chuyển vào **Thùng rác**. Mỗi nhóm trùng bắt buộc giữ lại ít nhất một bản.
- **Mặc định mọi thứ vào Thùng rác**, kể cả cache, log và `node_modules`. Chỉ xóa hẳn khi làm trống Thùng rác, hoặc khi bạn bật "Xóa hẳn cache, log, node_modules" ở màn Lịch sử và an toàn. Cache `com.apple.*` được bỏ qua.
- Danh sách cấm (`lib/safety.js`, kiểm tra ở tiến trình chính): không bao giờ đụng `/System`, `/usr`, `/private/var`, thư mục khung (Desktop, Documents, `~/Library`, `~/Library/Containers`...), dữ liệu ứng dụng Apple, thư viện Ảnh, kể cả khi bạn chọn.
- Mọi thao tác dọn được ghi vào lịch sử (`~/Library/Application Support/S Clean/history.jsonl`).
- Thumbnail tạo trên máy bằng API của macOS, không gửi dữ liệu đi đâu.
- Ảnh, video, file lớn không bao giờ được tick sẵn.
- Màn hình Dung lượng ẩn chỉ đọc. Việc duy nhất xóa hẳn ở đây là runtime Simulator, luôn hỏi lại và tải lại được trong Xcode.

## Chạy và build

```bash
npm install
npm start            # chạy thử
npm test             # test logic quét
npm run dist         # build .dmg + .zip vào thư mục dist/ (electron-builder)
npm run dist:arm64   # chỉ Mac chip Apple
```

Lần đầu quét Downloads, Documents, Desktop, macOS sẽ hỏi quyền truy cập: bấm Cho phép.
Muốn quét sao lưu iPhone hoặc Mail Downloads cần cấp **Full Disk Access** cho S Clean trong Cài đặt hệ thống > Quyền riêng tư và bảo mật.

## Cấu trúc

```
main.js            tiến trình chính, IPC, kiểm tra đường dẫn, thumbnail
preload.js         cầu nối an toàn tới giao diện
lib/               junk, bigfiles, media, dupfiles, dupapps, storage (dung lượng ẩn),
                   diskmap (bản đồ dung lượng), safety (danh sách cấm), history (lịch sử, cài đặt), util
renderer/          giao diện (HTML/CSS/JS thuần, không framework)
build/             logo.svg, icon.png
test/run.js        test logic bằng dữ liệu giả
```
