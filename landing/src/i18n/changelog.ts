export interface ChangelogEntry {
  version: string;
  date: string;
  platform: string;
  en: string[];
  vi: string[];
}

/** Summaries of the GitHub Releases, which stay the source for full notes and checksums. */
export const changelog: ChangelogEntry[] = [
  {
    version: '1.0.2',
    date: '2026-11-06',
    platform: 'macOS, Windows direct download',
    en: [
      'Swipe right to dismiss the floating capture preview, or two-finger swipe right on the trackpad.',
      'Reduced floating preview auto-dismiss delay to 1.5 seconds, with customizable duration (1.5s, 3s, 5s, 8s) in Settings.',
      'Dragging the thumbnail out to other apps continues to work seamlessly.',
    ],
    vi: [
      'Quẹt sang phải để tắt nhanh ảnh chụp xem trước nổi, hoặc vuốt 2 ngón sang phải trên trackpad.',
      'Giảm thời gian hiển thị tự tắt của ảnh xem trước xuống 1.5 giây, có thể điều chỉnh trong Cài đặt (1.5s, 3s, 5s, 8s).',
      'Kéo thả ảnh xem trước sang các ứng dụng khác vẫn hoạt động mượt mà.',
    ],
  },
  {
    version: '1.0.1',
    date: '2026-11-06',
    platform: 'macOS, Windows direct download',
    en: [
      'History keeps up to 50 saved captures across relaunches and refreshes when the hub opens or EiSen saves a capture.',
      'On the first launch after upgrading, EiSen imports up to 50 newest EiSen_*.png files from the configured save folder.',
      'Removing an item from History hides it from the gallery but leaves its PNG on disk. The Microsoft Store currently offers v1.0.0.',
    ],
    vi: [
      'Lịch sử giữ tối đa 50 ảnh đã lưu sau khi khởi động lại; được cập nhật khi mở trang chính hoặc khi EiSen lưu ảnh.',
      'Trong lần mở đầu tiên sau khi nâng cấp, EiSen nhập tối đa 50 file EiSen_*.png mới nhất từ thư mục lưu đã chọn.',
      'Xóa một mục khỏi Lịch sử chỉ ẩn mục đó khỏi thư viện, file PNG vẫn ở trên đĩa. Microsoft Store hiện vẫn cung cấp v1.0.0.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-11-03',
    platform: 'Windows',
    en: [
      'In the Microsoft Store, built from the same code as the Mac release.',
      'Adds Redact and Crop in the editor. The floating thumbnail and capture previous region are Mac only.',
      "Built and packaged automatically, and it hasn't been run on a real Windows PC yet, so it may have bugs.",
    ],
    vi: [
      'Có trên Microsoft Store, build từ cùng mã nguồn với bản Mac.',
      'Thêm Che đặc và Cắt ảnh trong trình sửa. Ảnh xem trước nổi và chụp lại vùng trước chỉ có trên Mac.',
      'Được build và đóng gói tự động, chưa được chạy thử trên máy Windows thật, nên có thể còn lỗi.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-11-03',
    platform: 'macOS',
    en: [
      'Redact: a solid block that replaces sensitive pixels in the exported image.',
      'Crop in the editor: non-destructive, with handles, and undo brings the previous bounds back.',
      'Capture previous region with Ctrl+Shift+2 or the tray menu.',
      'Floating thumbnail after each capture: click to edit or drag into another app.',
      'Faster capture on macOS 14 and later: about 120 ms from trigger to frozen screen, down from about 190 ms, on an M3 Pro.',
      'OCR reads Japanese and Korean. In the editor it reads only what you would export.',
    ],
    vi: [
      'Che đặc: một khối kín thay các pixel nhạy cảm trong ảnh xuất ra.',
      'Cắt ảnh trong trình sửa: không phá ảnh gốc, có tay kéo, hoàn tác sẽ trả lại khung cũ.',
      'Chụp lại vùng trước bằng Ctrl+Shift+2 hoặc menu trên khay.',
      'Ảnh xem trước nổi sau mỗi lần chụp: bấm để sửa hoặc kéo vào ứng dụng khác.',
      'Chụp nhanh hơn từ macOS 14: khoảng 120 ms từ lúc kích hoạt tới khi màn hình đóng băng, so với khoảng 190 ms trước đây, đo trên M3 Pro.',
      'OCR đọc được tiếng Nhật và tiếng Hàn. Trong trình sửa, OCR chỉ đọc phần bạn sẽ xuất ra.',
    ],
  },
  {
    version: '0.2.8',
    date: '2026-10-25',
    platform: 'macOS',
    en: [
      'Pen, pen arrow, and highlighter strokes filter hand tremor and render as smooth curves.',
      'New Pen smoothing setting: Off, Medium, or High.',
    ],
    vi: [
      'Nét bút, bút mũi tên và tô sáng được lọc rung tay và vẽ thành đường cong mượt.',
      'Thêm cài đặt Làm mượt nét bút: Tắt, Vừa hoặc Cao.',
    ],
  },
  {
    version: '0.2.7',
    date: '2026-10-23',
    platform: 'macOS',
    en: [
      'Copy, Save, and successful OCR close the selection overlay right away.',
      'The size badge shows real pixels on Retina displays.',
      'A new capture can start while the editor is open, without replacing the open file.',
    ],
    vi: [
      'Sao chép, Lưu và OCR thành công sẽ đóng lớp chọn vùng ngay.',
      'Nhãn kích thước hiển thị đúng số pixel thật trên màn hình Retina.',
      'Có thể chụp mới khi trình sửa đang mở mà không thay file đang mở.',
    ],
  },
  {
    version: '0.2.6',
    date: '2026-09-23',
    platform: 'macOS, Windows',
    en: [
      'Windows capture placement uses physical monitor coordinates, for mixed-DPI and negative-origin layouts.',
      'Windows save location handles redirected Desktop folders.',
      'Overlay failures cancel the capture cleanly, so a later capture can proceed.',
    ],
    vi: [
      'Vị trí chụp trên Windows dùng tọa độ vật lý của màn hình, phù hợp với cấu hình nhiều DPI và tọa độ âm.',
      'Thư mục lưu trên Windows hỗ trợ thư mục Desktop được chuyển hướng.',
      'Khi lớp chọn vùng gặp lỗi, lần chụp được hủy gọn để lần sau vẫn chụp được.',
    ],
  },
  {
    version: '0.2.5',
    date: '2026-09-18',
    platform: 'macOS, Windows',
    en: [
      'The Microsoft Store listing is live and is the recommended Windows install.',
      'On Windows, EiSen prefers PrintScreen and switches to Ctrl + Shift + 5 when another app owns it.',
      'Every downloadable file has a matching SHA-256 sidecar.',
    ],
    vi: [
      'EiSen đã có trên Microsoft Store, đây là cách cài được khuyên dùng trên Windows.',
      'Trên Windows, EiSen ưu tiên PrintScreen và chuyển sang Ctrl + Shift + 5 khi ứng dụng khác đã chiếm phím này.',
      'Mọi file tải về đều có file SHA-256 đi kèm.',
    ],
  },
];
