// Ma trận phân quyền: 5 phân hệ của hệ thống và vai trò được sử dụng từng chức năng.
// Dùng để hiển thị ở trang "Người dùng & phân quyền"; việc kiểm tra quyền thực tế nằm ở middleware requireRole.
const ROLES = [
  { key: 'student', name: 'Sinh viên', desc: 'Tài khoản cá nhân, đăng nhập bằng MSSV hoặc email sinh viên.' },
  { key: 'organizer', name: 'Ban tổ chức', desc: 'Tài khoản của đơn vị tổ chức sự kiện (email @neu.edu.vn).' },
  { key: 'doan', name: 'Văn phòng Đoàn', desc: 'Duyệt sự kiện, quản lý phòng, cộng và quản lý điểm Đoàn sinh viên.' },
  { key: 'media', name: 'Phòng Truyền thông', desc: 'Duyệt sự kiện về mặt truyền thông, duyệt banner và ấn phẩm truyền thông.' },
  { key: 'sysadmin', name: 'Quản trị hệ thống', desc: 'Quản lý người dùng, phân quyền, cấu hình và an ninh dữ liệu.' },
];

const MODULES = [
  {
    key: 'student', name: 'Phân hệ Sinh viên',
    functions: [
      { name: 'Tìm kiếm, tra cứu thông tin sự kiện', roles: ['student', 'organizer', 'doan', 'media'] },
      { name: 'Đăng ký giữ chỗ, hủy đăng ký', roles: ['student'] },
      { name: 'Điểm danh check-in / check-out (mã, QR)', roles: ['student'] },
      { name: 'Theo dõi lịch sử hoạt động, điểm Đoàn', roles: ['student'] },
      { name: 'Đánh giá sự kiện sau khi tham dự', roles: ['student'] },
    ],
  },
  {
    key: 'organizer', name: 'Phân hệ Ban tổ chức',
    functions: [
      { name: 'Tạo, chỉnh sửa hồ sơ sự kiện, đăng ký phòng, gửi duyệt', roles: ['organizer'] },
      { name: 'Gửi banner, ấn phẩm truyền thông để duyệt', roles: ['organizer'] },
      { name: 'Quản lý danh sách người tham gia, mở phiên QR check-in / check-out', roles: ['organizer'] },
      { name: 'Gửi danh sách hoàn thành để Văn phòng Đoàn cộng điểm', roles: ['organizer'] },
      { name: 'Thống kê, xuất báo cáo sự kiện của đơn vị', roles: ['organizer'] },
    ],
  },
  {
    key: 'doan', name: 'Phân hệ Văn phòng Đoàn',
    functions: [
      { name: 'Duyệt sự kiện (nội dung, phòng, cấp chương trình & điểm Đoàn)', roles: ['doan'] },
      { name: 'Quản lý phòng, lịch sử dụng phòng', roles: ['doan'] },
      { name: 'Duyệt danh sách cộng điểm Đoàn', roles: ['doan'] },
      { name: 'Xem điểm Đoàn, lịch sử điểm từng sinh viên; cộng / trừ điểm', roles: ['doan'] },
      { name: 'Báo cáo thống kê toàn trường', roles: ['doan', 'media'] },
    ],
  },
  {
    key: 'media', name: 'Phân hệ Phòng Truyền thông',
    functions: [
      { name: 'Duyệt sự kiện về mặt truyền thông (ảnh bìa, nội dung giới thiệu)', roles: ['media'] },
      { name: 'Duyệt banner, poster, standee, bài đăng, video', roles: ['media'] },
      { name: 'Theo dõi ấn phẩm của các sự kiện toàn trường', roles: ['media', 'doan'] },
    ],
  },
  {
    key: 'sysadmin', name: 'Phân hệ Quản trị hệ thống',
    functions: [
      { name: 'Quản lý người dùng, cấp tài khoản', roles: ['sysadmin'] },
      { name: 'Phân quyền (đổi vai trò), khóa / mở khóa tài khoản', roles: ['sysadmin'] },
      { name: 'Cấu hình tham số hệ thống, chế độ bảo trì', roles: ['sysadmin'] },
      { name: 'Nhật ký hệ thống, giám sát phiên đăng nhập', roles: ['sysadmin'] },
      { name: 'Sao lưu cơ sở dữ liệu, theo dõi hạ tầng', roles: ['sysadmin'] },
    ],
  },
];

module.exports = { ROLES, MODULES };
