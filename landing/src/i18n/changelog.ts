import { releaseMetadata } from "./release";

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
    version: releaseMetadata.mac.version,
    date: '2026-11-22',
    platform: releaseMetadata.windowsStore.version === releaseMetadata.mac.version
      ? `macOS, Windows (Microsoft Store v${releaseMetadata.windowsStore.version})`
      : 'macOS',
    en: [
      'Dragging the floating capture preview on Mac now moves the entire preview card frame smoothly with the cursor, gliding back if released or fading out on drop.',
      'macOS Dock & Recent Applications stay hidden from initial launch by configuring Accessory activation policy before the event loop starts.',
    ],
    vi: [
      'Kéo-thả ảnh xem trước nổi trên Mac giờ di chuyển nguyên cả khung preview theo con trỏ thay vì bóng mờ mặc định, tự trượt về góc nếu buông ra hoặc mờ dần khi thả vào ứng dụng khác.',
      'Sửa lỗi icon EiSen còn xuất hiện ở mục Mở gần đây trên Dock macOS bằng cách thiết lập chế độ chạy nền Accessory trước khi khởi chạy event loop.',
    ],
  },
  {
    version: '1.1.1',
    date: '2026-11-22',
    platform: 'macOS, Windows (Microsoft Store v1.1.1)',
    en: [
      'Floating preview swipe-to-dismiss on Mac now follows your pointer or two-finger trackpad motion 1:1 and springs back if released early.',
      'Diagonal and upward drags on the floating preview start file drag-and-drop reliably, animating back to the preview if released without dropping.',
    ],
    vi: [
      'Thao tác quẹt ngang để đóng ảnh xem trước trên Mac giờ đi theo chuyển động chuột hoặc hai ngón tay 1:1 và tự bật về vị trí cũ nếu buông sớm.',
      'Kéo chéo hoặc kéo lên để kéo-thả file ảnh xem trước sang ứng dụng khác mượt mà hơn, tự quay lại khung xem trước nếu thả ra ngoài.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-11-22',
    platform: 'macOS',
    en: [
      'The editor waits for the image to load and offers fit-to-view and 100% zoom.',
      'Dismiss the floating preview on Mac with a continuous two-finger horizontal swipe. Click to edit and drag to share still work.',
      'Redact stays opaque with overlapping blur, and OCR uses the image and crop shown in the editor.',
      'Concurrent saves choose separate filenames, and History keeps captures on temporarily unavailable drives.',
    ],
    vi: [
      'Trình sửa đợi ảnh tải xong và hỗ trợ chế độ vừa khung xem hoặc thu phóng 100%.',
      'Vuốt ngang hai ngón để đóng ảnh xem trước trên Mac. Bấm để sửa hoặc kéo file sang ứng dụng khác.',
      'Vùng Che đặc vẫn giữ kín ảnh khi chồng với Làm mờ. OCR dùng đúng ảnh và vùng cắt trong trình sửa.',
      'Các lượt lưu đồng thời dùng tên file riêng. Lịch sử giữ mục trên ổ đĩa tạm thời không truy cập được.',
    ],
  },
  {
    version: '1.0.2',
    date: '2026-11-06',
    platform: 'macOS, Windows (Microsoft Store v1.0.2 and direct download)',
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
    platform: 'macOS, Windows (Microsoft Store v1.0.1 and direct download)',
    en: [
      'History keeps up to 50 saved captures across relaunches and refreshes when the hub opens or EiSen saves a capture.',
      'On the first launch after upgrading, EiSen imports up to 50 newest EiSen_*.png files from the configured save folder.',
      'Removing an item from History hides it from the gallery but leaves its PNG on disk.',
    ],
    vi: [
      'Lịch sử giữ tối đa 50 ảnh đã lưu sau khi khởi động lại; được cập nhật khi mở trang chính hoặc khi EiSen lưu ảnh.',
      'Trong lần mở đầu tiên sau khi nâng cấp, EiSen nhập tối đa 50 file EiSen_*.png mới nhất từ thư mục lưu đã chọn.',
      'Xóa một mục khỏi Lịch sử chỉ ẩn mục đó khỏi thư viện, file PNG vẫn ở trên đĩa.',
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
