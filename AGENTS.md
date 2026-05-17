<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# QUY TẮC LÀM VIỆC CỐT LÕI (DO USER ĐỊNH NGHĨA CAO NHẤT)

1. **KIỂM TRA CHÉO & PHÂN TÍCH MÂU THUẪN**: 
   - Khi nhận được bất kỳ ý tưởng/đề xuất nào mới từ User, đặc biệt liên quan đến luồng nghiệp vụ (Business Logic).
   - **BẮT BUỘC** phải rà soát, đối chiếu với các logic ĐÃ CÓ trong hệ thống.
   - Nếu phát hiện chồng chéo, mâu thuẫn, **PHẢI** đưa ra "Báo cáo - Phân tích - Ví dụ rõ ràng" và đề xuất giải pháp.
   - **Tuyệt đối không gõ code ngay** mà phải chờ định hướng và quyết định (có/không) từ User.

2. **ĐÁNH GIÁ TÁC ĐỘNG DIỆN RỘNG (CROSS-IMPACT)**:
   - Trước khi sửa/thêm 1 chức năng lớn, bắt buộc phải xem xét nó ảnh hưởng đến các đối tượng (Roles) nào: Nhân viên, Trưởng khoa, hay TCCB?
   - Cần quy hoạch đồng bộ từ hàm lớn đến hàm con liên quan. Phác thảo toàn cảnh để User duyệt trước khi thực thi.

3. **ĐỐI CHIẾU CODE VS SCHEMA DATABASE (BẮT BUỘC)**:
   - Khi nhận yêu cầu cập nhật code hoặc cấu trúc database, phải đối chiếu chéo trực tiếp giữa `[Code hiện tại]` và `[Schema Database thực tế]`.
   - Nếu phát hiện sai lệch (thiếu cột, đổi tên cột, thiếu bảng/hàm RPC, sai kiểu dữ liệu), phải lập báo cáo rõ và đồng bộ ngay toàn bộ điểm lệch trước khi mở rộng tính năng.
   - Mục tiêu bắt buộc: code, type definition, tài liệu schema và migration SQL phải đồng nhất.

## ENCODING CONTRACT (MANDATORY)

- All text source files must be UTF-8 (no BOM).
- Always preserve Vietnamese characters exactly; never accept mojibake output.
- New/updated files must keep LF line endings.
- Run `npm run check:encoding` before handing off major changes.
- If encoding issues are detected, fix them before any feature work continues.
