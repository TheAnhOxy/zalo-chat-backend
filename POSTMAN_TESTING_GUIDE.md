# Hướng dẫn Test Auth API với Postman

## Bước 1: Import Postman Collection

1. Mở Postman
2. Click "Import"
3. Chọn file: `postman-auth-collection.json`
4. Done - collection mới được chia thành 3 nhóm: Main Auth Flow, Password & Session, Phone OTP Login

## Bước 2: Setup biến Postman

Các biến đã tạo sẵn:

- `base_url` = http://localhost:8081/api/v1
- `sessionId` = để trống (sẽ auto fill)
- `userId` = để trống (sẽ auto fill)
- `accessToken` = để trống (sẽ auto fill)
- `refreshToken` = để trống (sẽ auto fill)

## Bước 3: Chạy server

```
npm run start:dev
```

Chờ tới khi thấy:

```
Application is running on: http://localhost:8081
Swagger documentation: http://localhost:8081/api
```

Nếu gặp lỗi `EADDRINUSE: address already in use :::8081`, port 8081 đang bị process Node khác giữ. Tắt process cũ rồi chạy lại `npm run start:dev`.

## Bộ dữ liệu test nhanh

### Data Set A - Đăng ký và login chuẩn

- `fullName`: Nguyen Van A
- `phone`: 0912345678
- `email`: test.user@gmail.com
- `password`: Password@123
- `newPassword`: NewPass@123
- `finalPassword`: FinalPass@123

### Data Set B - Quên mật khẩu

- `fullName`: Nguyen Van B
- `phone`: 0987654321
- `email`: reset.user@gmail.com
- `password`: Reset@12345
- `newPassword`: ResetNew@123

### Data Set C - Phone OTP login

- `fullName`: Nguyen Van C
- `phone`: 0901234567
- `email`: phone.user@gmail.com
- `password`: Phone@12345

### Cách nhập nhanh trong Postman

1. Set biến `email`, `phone`, `password`, `newPassword`, `finalPassword` theo 1 bộ dữ liệu.
2. Chạy `1. Register - send OTP to email`.
3. Lấy `sessionId` từ response.
4. Điền `otp` thật từ Gmail inbox vào biến Postman.
5. Chạy `2. Verify Register OTP` rồi tiếp tục `3. Login` và `4. Refresh Token`.

## Bước 4: Test Flow Chính (theo thứ tự)

### 1. REGISTER

1. Mở request "1. Register - send OTP to email"
2. Click **Send**
3. Xem response - nó sẽ trả `data.sessionId`
4. **Quan trọng**: Hãy check **hộp thư Gmail** của email đang test để lấy OTP.

5. Copy `sessionId` từ response vào biến Postman (hoặc auto-save từ test script)

### 2. VERIFY REGISTER OTP

1. Mở request "2. Verify Register OTP"
2. **Bước quan trọng**: Điền OTP thật vào biến `otp` trong Postman trước khi gửi
3. Click **Send**
4. Nó sẽ tự save `userId`, `accessToken`, `refreshToken` vào biến Postman

### 3. LOGIN

1. Mở request "3. Login"
2. Có thể dùng email hoặc phone:
   - Email: `"identifier": "{{email}}"`
   - Phone: `"identifier": "{{phone}}"`
3. Click **Send**
4. Sẽ lấy token mới, test script tự save lại biến

### 4. REFRESH TOKEN

1. Request "4. Refresh Token"
2. Click **Send** - lấy accessToken mới từ refreshToken cũ

### 5. LOGOUT CURRENT DEVICE

1. Request "5. Logout current device"
2. Click **Send** - session hiện tại bị revoke

### 6. FORGOT PASSWORD - REQUEST OTP

1. Request "6. Forgot Password - Request OTP"
2. Click **Send**
3. **Check Gmail inbox** để lấy OTP mới (vì quên password).
4. Test script sẽ save sessionId mới
5. Hãy chắc chắn `email` đang trỏ tới user đã đăng ký trước đó

### 7. FORGOT PASSWORD - VERIFY OTP

1. Request "7. Forgot Password - Verify OTP"
2. **Thay OTP**: điền giá trị thật vào biến `otp`
3. Click **Send**
4. Mật khẩu đã reset thành `NewPass@123`

### 8. RESEND OTP

1. Request "8. Resend OTP"
2. Click **Send** - OTP mới sẽ gửi qua email
3. Test script save sessionId mới

### 9. PHONE LOGIN - REQUEST OTP

1. Request "12. Phone Login - Request OTP"
2. Click **Send**
3. **Check Gmail inbox** lấy OTP
4. Test script save sessionId
5. `phone` phải là số đã tồn tại trong DB

### 10. PHONE LOGIN - VERIFY OTP

1. Request "13. Phone Login - Verify OTP"
2. **Thay OTP**: điền giá trị thật vào biến `otp`
3. Click **Send**
4. Tự save tokens

### 11. GET SESSIONS

1. Request "11. Get Sessions by User"
2. Click **Send** - xem tất cả session của user

### 12. CHANGE PASSWORD

1. Request "12. Change Password"
2. Click **Send** - đổi mật khẩu
3. Tất cả session cũ sẽ bị revoke (logout toàn bộ)

### 13. LOGOUT ALL DEVICES

1. Request "13. Logout All Devices"
2. Click **Send** - logout hết mọi thiết bị

---

## Test Case Lỗi

### Email sai format

Request: "[ERROR TEST] Invalid Email Format"
Mong đợi: `"code": "INVALID_EMAIL_FORMAT"`

### Phone sai format

Request: "[ERROR TEST] Invalid Phone Format"
Mong đợi: `"code": "INVALID_PHONE_FORMAT"`

### Password yếu (< 8 ký tự, không có chữ hoa, chữ thường, số)

Request: "[ERROR TEST] Weak Password"
Mong đợi: `"code": "WEAK_PASSWORD"`

### OTP sai/hết hạn

Request: "[ERROR TEST] Invalid OTP"
Mong đợi: `"code": "OTP_INVALID_OR_EXPIRED"`

### Sai mật khẩu login

Request: "[ERROR TEST] Invalid Credentials"
Mong đợi: `"code": "INVALID_CREDENTIALS"`

---

## Lưu ý quan trọng

1. **OTP không gắn cứng**: Mỗi lần gọi API register/forgot-password/phone-login sẽ sinh OTP mới
2. OTP phải lấy từ email inbox đã đăng ký
3. **OTP có hạn**: Mặc định 120 giây (configurable qua env)
4. **Resend OTP**: Cần chờ 120 giây mới có thể resend (configurable)
5. **Test script auto-save**: Các endpoint đã có test script tự động xử lý sessionId/userId/tokens

---

## Cấu hình Email (Gmail thật)

Thêm vào `.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-gmail-app-password
SMTP_PORT=587
SMTP_FROM=your-email@gmail.com
```

Gmail thường cần **App Password**, không dùng mật khẩu đăng nhập thường.
Nếu `SMTP_PASS` chưa có hoặc sai, API sẽ trả lỗi gửi OTP thất bại.

---

## Dữ liệu test mẫu (không gắn cứng)

**Account test mẫu:**

- Phone: 0912345678
- Email: test.user@gmail.com
- Password: Password@123
- NewPassword: NewPass@123
- FinalPassword: FinalPass@123

**Account reset mẫu:**

- Phone: 0987654321
- Email: reset.user@gmail.com
- Password: Reset@12345
- NewPassword: ResetNew@123

**Account phone login mẫu:**

- Phone: 0901234567
- Email: phone.user@gmail.com
- Password: Phone@12345

**Valid Phone VN Format:**

- 0912345678 ✓
- 0987654321 ✓
- 0901234567 ✓
- +84912345678 ✓ (auto convert to 0912345678)

**Strong Password Format:**

- Tối thiểu 8 ký tự
- Có chữ hoa (A-Z)
- Có chữ thường (a-z)
- Có số (0-9)
- Ví dụ: Demo@123, Pass@2026, TestAbc@123

**Weak Password (sẽ reject):**

- demo123 (không có chữ hoa)
- DEMO123 (không có chữ thường)
- DemoAbc (không có số)
- Demo@1 (< 8 ký tự)
