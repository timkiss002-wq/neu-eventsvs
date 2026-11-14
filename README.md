# NEUeventvs1 – Hệ thống quản lý sự kiện NEU (5 phân hệ)

Website quản lý sự kiện cho Đại học Kinh tế Quốc dân: sinh viên khám phá – đăng ký – điểm danh – đánh giá; ban tổ chức tạo hồ sơ, đăng ký phòng, gửi ấn phẩm và quản lý điểm danh; **Văn phòng Đoàn** duyệt sự kiện, quản lý phòng và điểm Đoàn; **Phòng Truyền thông** duyệt sự kiện về mặt truyền thông, duyệt banner và ấn phẩm; quản trị hệ thống quản lý người dùng – phân quyền, cấu hình và an ninh dữ liệu.

> Phiên bản tách từ `neu-events`: giữ nguyên logo, trang chủ, hình ảnh; màu chủ đạo xanh dương; thay phân hệ “Đơn vị quản lý” bằng Văn phòng Đoàn và Phòng Truyền thông.
>
> **Quy trình duyệt tuần tự:** Ban tổ chức nộp **kế hoạch + ấn phẩm truyền thông** → **Văn phòng Đoàn** duyệt và **cấp điểm Đoàn** → **Phòng Truyền thông** duyệt ấn phẩm → sự kiện mới hiển thị cho sinh viên.

- **Back-end:** Node.js + Express (REST API), phiên đăng nhập bằng cookie (express-session)
- **CSDL:** SQLite – dùng module có sẵn `node:sqlite` của Node, **không cần cài server CSDL**
- **Front-end:** HTML/CSS/JS thuần (giữ nguyên bộ thiết kế gốc), gọi API bằng `fetch`

---

## 1. Cài đặt & chạy

**Yêu cầu:** Node.js **22.13 trở lên** (khuyến nghị Node 24 LTS) – tải tại <https://nodejs.org>. Kiểm tra: `node -v`.

```bash
cd NEUeventvs1
npm install        # cài thư viện (chỉ lần đầu)
npm start          # chạy máy chủ
```

Mở trình duyệt: **http://localhost:3000**

- Lần chạy đầu tiên hệ thống tự tạo file CSDL `data/neu-events.db` và dữ liệu mẫu.
- `npm run seed` – xóa và tạo lại dữ liệu mẫu (**nên chạy ngay trước buổi demo**: thời gian sự kiện mẫu được tính theo ngày chạy seed, nên luôn có sự kiện *đã kết thúc / đang diễn ra / sắp diễn ra*; sự kiện “Ứng dụng AI…” đang diễn ra trong ~3,5 giờ kể từ lúc seed và đã mở sẵn phiên check-in – mã QR/mã nhập tay **động, tự đổi mỗi 10 giây**, xem trên trang *Điểm danh* của BTC).
- `npm run dev` – chạy và tự khởi động lại khi sửa code.
- Đổi cổng: `PORT=4000 npm start` (Windows PowerShell: `$env:PORT=4000; npm start`).

## 2. Tài khoản demo (mật khẩu chung: `123456`)

| Vai trò | Đăng nhập | Ghi chú |
|---|---|---|
| Sinh viên | `11240123` | Thân Mậu Dũng – có đủ trạng thái tham dự, có điểm Đoàn từ sự kiện và điều chỉnh |
| Sinh viên | `11244035` | Lê Văn Dũng |
| Ban tổ chức | `cntt@neu.edu.vn` | LCĐ Khoa CNTT – sự kiện đang diễn ra, sắp tới, nháp; có poster chờ duyệt |
| Ban tổ chức | `dmst@neu.edu.vn` | Viện ĐMST – hồ sơ đã qua bước 1 (VP Đoàn), đang chờ Phòng Truyền thông duyệt ấn phẩm |
| Ban tổ chức | `clbkhoinghiep@neu.edu.vn` | CLB Khởi nghiệp – hồ sơ bị VP Đoàn từ chối (quá sức chứa phòng) |
| Ban tổ chức | `hoisinhvien@neu.edu.vn` | Hội Sinh viên – hồ sơ đang ở bước 1 (chờ VP Đoàn), có ấn phẩm bị từ chối |
| Văn phòng Đoàn | `vpdoan@neu.edu.vn` | Duyệt sự kiện, quản lý phòng, duyệt & quản lý điểm Đoàn |
| Phòng Truyền thông | `truyenthong@neu.edu.vn` | Duyệt sự kiện (truyền thông), duyệt banner / ấn phẩm |
| Quản trị hệ thống | `quantri@neu.edu.vn` | Người dùng & phân quyền, cấu hình, an ninh & sao lưu dữ liệu |

Tài khoản cán bộ / đơn vị dùng email đuôi `@neu.edu.vn`, do Quản trị hệ thống cấp. Trang đăng nhập có mục “Tài khoản demo” để điền nhanh. Ngoài ra còn ~118 sinh viên ngẫu nhiên (MSSV từ `11240200`).

## 3. Chức năng theo phân hệ (5 phân hệ)

**Khách (không cần đăng nhập)**
- Người ngoài Trường xem được danh sách, lịch tháng và chi tiết các sự kiện đã công khai (`/events.html`, liên kết “Xem các sự kiện của Trường” ở trang đăng nhập); ấn phẩm đã duyệt hiển thị, kế hoạch tổ chức thì không.
- Muốn đăng ký tham gia phải đăng nhập bằng tài khoản sinh viên NEU (nút “Đăng nhập để đăng ký” đưa về đúng sự kiện sau khi đăng nhập).

**Sinh viên**
- Khám phá, đăng ký / hủy đăng ký sự kiện, check-in / check-out bằng mã hoặc QR, đánh giá (có ẩn danh).
- Theo dõi *Đã đăng ký* và **điểm Đoàn** (gồm điểm từ sự kiện và điểm Văn phòng Đoàn điều chỉnh) theo học kỳ.

**Ban tổ chức**
- Tạo / sửa hồ sơ sự kiện, **chọn phòng** trong danh mục do Văn phòng Đoàn quản lý (hoặc địa điểm khác); hệ thống chặn quá sức chứa và trùng lịch phòng.
- **Nộp hồ sơ = kế hoạch tổ chức (file) + ấn phẩm truyền thông** (banner, poster…), thêm ngay trong form; thiếu một trong hai thì không nộp được. Theo dõi tiến độ bước 1 / bước 2.
- **Ấn phẩm truyền thông**: xem trạng thái, xóa ấn phẩm chưa duyệt, gửi bản chỉnh sửa khi bị từ chối, gửi ấn phẩm bổ sung sau khi sự kiện công khai.
- Điểm danh (mở phiên check-in/check-out, QR, sửa thủ công có lý do), xuất Excel, **gửi danh sách hoàn thành cho Văn phòng Đoàn cộng điểm**, xem đánh giá, báo cáo của đơn vị.

**Văn phòng Đoàn**
- **Duyệt sự kiện – bước 1**: kế hoạch tổ chức, phòng/địa điểm (cảnh báo sức chứa, trùng lịch), **cấp chương trình & cấp điểm Đoàn**, hồ sơ và kinh phí. Duyệt xong hồ sơ chuyển sang Phòng Truyền thông.
- **Quản lý phòng**: thêm / sửa phòng, tạm ngưng (bắt buộc lý do), lịch sử dụng phòng.
- **Duyệt điểm Đoàn**: duyệt / từ chối danh sách sinh viên hoàn thành do BTC gửi → cộng điểm.
- **Điểm Đoàn sinh viên**: bảng điểm theo học kỳ / lớp, **lịch sử điểm từng sinh viên**, hoạt động chờ cộng điểm, **cộng / trừ điểm thủ công** (bắt buộc căn cứ), xuất Excel.
- Báo cáo thống kê toàn trường, xem đánh giá.

**Phòng Truyền thông**
- **Duyệt sự kiện – bước 2** (chỉ sau khi VP Đoàn đã duyệt): xem trước banner, poster nộp kèm hồ sơ; duyệt → các ấn phẩm được duyệt và **sự kiện được công khai**; từ chối → hồ sơ trả về BTC.
- **Duyệt ấn phẩm bổ sung** cho sự kiện đã công khai (ảnh / PDF / video); ấn phẩm đã duyệt hiển thị trên trang chi tiết sự kiện.
- Báo cáo thống kê toàn trường, xem đánh giá.

**Quản trị hệ thống** (giữ nguyên): tổng quan hệ thống, người dùng & phân quyền (5 vai trò, ma trận phân quyền 5 phân hệ), cấu hình hệ thống, an ninh & sao lưu dữ liệu.

**Chung:** thông báo trong hệ thống, hồ sơ cá nhân, đổi / quên mật khẩu, lịch sử thao tác, hướng dẫn sử dụng theo vai trò, giao diện responsive.

## 4. Quy tắc nghiệp vụ chính

- Trạng thái hồ sơ: `draft → pending → approved | rejected`; `approved → cancelled`. Chỉ sửa được khi *Nháp* hoặc *Bị từ chối*.
- **Điều kiện nộp:** hồ sơ có ít nhất 1 file kế hoạch tổ chức và ít nhất 1 ấn phẩm truyền thông chưa bị từ chối.
- **Duyệt tuần tự:** bước 1 Văn phòng Đoàn (duyệt + cấp điểm Đoàn) → bước 2 Phòng Truyền thông (duyệt ấn phẩm; không thể duyệt trước bước 1) → công khai. Bước nào từ chối (bắt buộc lý do ≥ 10 ký tự) → hồ sơ trả về BTC; nộp lại bắt đầu từ bước 1. Phòng Truyền thông chỉ nhận thông báo khi hồ sơ đến bước 2.
- **Phòng:** quy mô sự kiện ≤ sức chứa phòng; không trùng giờ với sự kiện khác cùng phòng đã duyệt (hoặc đã được VP Đoàn chấp thuận). Kiểm tra khi BTC lưu hồ sơ và khi VP Đoàn chấp thuận. Phòng đang có sự kiện sắp tới không được tạm ngưng.
- **Ấn phẩm:** chỉ ấn phẩm *Đã duyệt* được hiển thị công khai; ấn phẩm đã duyệt không xóa được.
- **Điểm Đoàn** = điểm từ danh sách hoàn thành được VP Đoàn duyệt (theo cấp chương trình) + điều chỉnh thủ công (−20…+20 mỗi lần, bắt buộc căn cứ, sinh viên nhận thông báo).
- Đăng ký, hủy, điểm danh, đánh giá, báo cáo: giữ như bản gốc (check-out cần đã check-in; đóng check-in → vắng mặt; đã cộng điểm thì không sửa điểm danh…).

## 5. QR điểm danh bằng điện thoại

Khi mở trang bằng `localhost`, mã QR tự dùng **địa chỉ LAN** của máy (in ra khi chạy `npm start`, dạng `http://192.168.x.x:3000`). Điện thoại kết nối **cùng Wi-Fi** quét QR → mở trang điểm danh, đăng nhập tài khoản sinh viên → tự xác nhận. Nếu Windows Firewall hỏi, chọn *Allow* cho Node.js.

**Chống điểm danh hộ:** mã QR và mã nhập tay là **mã động đổi mỗi 10 giây** (HMAC của khóa bí mật phiên + khung thời gian 10 giây; chấp nhận thêm khung liền trước để bù độ trễ, tức mã sống tối đa ~20 giây). Ảnh chụp QR hay link/mã gửi qua tin nhắn cho người không có mặt sẽ hết hạn, sinh viên phải quét mã đang trình chiếu. BTC bấm *Trình chiếu QR* để phóng to mã lên màn hình; mã tự làm mới, có thanh đếm ngược.

## 6. Cấu trúc thư mục

```
NEUeventvs1/
├── server.js              # Khởi tạo Express, gắn route, phục vụ giao diện
├── db/                    # schema.sql (15 bảng), database.js, seed.js (dữ liệu mẫu)
├── middleware/auth.js     # Nạp người dùng từ session, kiểm tra vai trò
├── lib/                   # util.js, events.js (quyền, phòng trùng lịch), settings.js, permissions.js (5 phân hệ)
├── routes/
│   ├── moderation.js      # Duyệt sự kiện 2 bên (Văn phòng Đoàn + Phòng Truyền thông)
│   ├── doan.js            # Văn phòng Đoàn: duyệt điểm, điểm Đoàn sinh viên, cộng/trừ, xuất Excel
│   ├── rooms.js           # Quản lý phòng, lịch phòng
│   ├── media.js           # Ấn phẩm truyền thông
│   └── auth, events, me, attendance, reviews, reports, system
├── public/                # Giao diện (HTML/CSS/JS thuần)
│   ├── moderation.html    # Duyệt sự kiện (VP Đoàn / Truyền thông)
│   ├── points.html        # Duyệt điểm Đoàn
│   ├── union-points.html  # Điểm Đoàn sinh viên
│   ├── rooms.html         # Quản lý phòng
│   ├── media-assets.html  # Ấn phẩm truyền thông (BTC gửi / Truyền thông duyệt)
│   └── ... các trang khác giữ nguyên bản gốc
├── uploads/               # Ảnh bìa, file đính kèm, ấn phẩm (tạo khi chạy)
├── data/                  # File CSDL SQLite (tạo khi chạy)
└── docs/                  # DATABASE.md, API.md
```

## 7. Kịch bản demo gợi ý (~12 phút)

1. `npm run seed` → `npm start`.
2. **cntt@neu.edu.vn** → *Quản lý sự kiện* → *Tạo sự kiện mới*: chọn phòng (thử *Phòng máy B305* với quy mô 100 để thấy cảnh báo quá sức chứa), đính kèm **kế hoạch tổ chức** và thêm **ấn phẩm** (banner) → *Lưu & nộp hồ sơ*. Bảng hồ sơ hiện tiến độ “1. VP Đoàn / 2. Truyền thông”.
3. **truyenthong@neu.edu.vn** (cửa sổ ẩn danh) → *Duyệt sự kiện*: hồ sơ vừa nộp hiện “Chưa đến lượt”, chưa duyệt được.
4. **vpdoan@neu.edu.vn** → *Duyệt sự kiện* → xem kế hoạch, kiểm tra phòng, chọn điểm Đoàn → *Duyệt & cấp điểm Đoàn*. Sinh viên vẫn chưa thấy sự kiện.
5. **truyenthong@neu.edu.vn** → *Duyệt sự kiện* → xem banner → *Duyệt ấn phẩm & công khai sự kiện*. Thử *Từ chối* hồ sơ “Cuộc thi Ý tưởng khởi nghiệp” để thấy hồ sơ trả về BTC.
6. **11240123** → đăng ký sự kiện vừa công khai (trang chi tiết có mục *Ấn phẩm truyền thông*).
7. **cntt@neu.edu.vn** → *Điểm danh* → “Ứng dụng AI…” → *Trình chiếu QR* (mã đổi mỗi 10 giây), sinh viên nhập/quét mã đang hiện → check-in / check-out; sự kiện “Seminar Python” → *Gửi danh sách nhận điểm*.
8. **vpdoan@neu.edu.vn** → *Duyệt điểm Đoàn* → duyệt; *Điểm Đoàn sinh viên* → tìm `11240123` → xem lịch sử điểm → *Cộng / trừ điểm*; *Xuất bảng điểm Excel*.
9. **vpdoan@neu.edu.vn** → *Quản lý phòng* → thêm phòng, tạm ngưng phòng, xem lịch sử dụng phòng.
10. **quantri@neu.edu.vn** → *Người dùng & phân quyền* → cấp tài khoản Văn phòng Đoàn / Phòng Truyền thông, xem *Ma trận phân quyền* 5 phân hệ.

## 8. Giới hạn (phạm vi môn học)

- Chạy trên localhost; phiên đăng nhập lưu trong bộ nhớ – khởi động lại máy chủ cần đăng nhập lại.
- Không có máy chủ email: mã quên mật khẩu hiển thị trên màn hình và in ở console (chế độ demo).
- Không có trang tự đăng ký: tài khoản do Quản trị hệ thống cấp (ngoài dữ liệu mẫu).
- Phiên đăng nhập lưu trong bộ nhớ nên danh sách phiên mất khi khởi động lại máy chủ.
