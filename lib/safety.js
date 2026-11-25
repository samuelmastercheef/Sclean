'use strict';
const path = require('path');

// Những đường dẫn không bao giờ được chuyển vào Thùng rác hay xóa, dù có nằm trong kết quả quét.
// Trả về lý do (chuỗi) nếu bị cấm, null nếu được phép.
function protectedReason(p, home) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return 'Đường dẫn không hợp lệ';
  const n = path.normalize(p).replace(/\/+$/, '') || '/';
  // Bỏ tiền tố volume Data của APFS để so sánh như đường dẫn thường
  const q = n.replace(/^\/System\/Volumes\/Data(?=\/|$)/, '') || '/';
  const H = home.replace(/\/+$/, '');
  const under = (base) => q === base || q.startsWith(base + '/');

  if (q === '/') return 'Thư mục gốc của ổ đĩa';
  for (const sys of ['/System', '/usr', '/bin', '/sbin', '/private/var/db', '/private/var/vm', '/private/etc', '/cores', '/dev', '/Volumes']) {
    if (under(sys)) return 'Thư mục hệ thống của macOS';
  }
  if (under('/Library/Apple') || under('/Library/Developer/CommandLineTools')) return 'Thành phần hệ thống của Apple';
  if (/^\/Applications\/(Utilities\/)?[^/]+\.app$/.test(q) && /\/(Safari|Finder|App Store|System Settings|System Preferences)\.app$/.test(q)) {
    return 'Ứng dụng hệ thống của Apple';
  }

  // Các thư mục "khung" không được xóa nguyên cả thư mục
  const frames = ['/Applications', '/Library', '/Users', '/Users/Shared', '/private', '/private/var', '/opt', '/usr/local', H,
    ...['Library', 'Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music', 'Public', 'Applications',
      'Library/Application Support', 'Library/Containers', 'Library/Group Containers', 'Library/Caches',
      'Library/Preferences', 'Library/Developer', 'Library/Mobile Documents', 'Library/CloudStorage', '.Trash']
      .map((d) => path.join(H, d))];
  if (frames.includes(q)) return 'Thư mục khung của hệ thống, chỉ dọn bên trong';

  if (!under(H) && !under('/Applications') && !under('/Library') && !under('/Users/Shared') && !under('/opt') && !under('/usr/local')) {
    return 'Nằm ngoài vùng S Clean được phép dọn';
  }
  // Dữ liệu của Apple trong Thư viện người dùng (Keychain, Mail, Photos nội bộ...)
  const rel = path.relative(H, q);
  if (/^Library\/(Keychains|Mail|Messages|Safari|Accounts|Cookies|Calendars|Reminders|Photos|IdentityServices|Sharing|Suggestions)(\/|$)/.test(rel)) {
    return 'Dữ liệu của ứng dụng Apple, hãy dọn trong chính ứng dụng đó';
  }
  if (/(^|\/)com\.apple\.[^/]*$/.test(rel) && /^Library\/(Containers|Group Containers|Application Support|Preferences)\//.test(rel)) {
    return 'Dữ liệu của ứng dụng Apple';
  }
  if (/\.photoslibrary(\/|$)/.test(q)) return 'Thư viện Ảnh, hãy dọn trong ứng dụng Ảnh';
  return null;
}

module.exports = { protectedReason };
