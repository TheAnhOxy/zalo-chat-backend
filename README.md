# Backend API - Web Thuê Đồ Cosplay

Backend được xây dựng bằng NestJS với TypeORM, PostgreSQL (Neon), và JWT authentication.

## Cấu trúc dự án

```
src/
├── entities/          # Database entities
│   ├── user.entity.ts
│   ├── category.entity.ts
│   ├── product.entity.ts
│   ├── order.entity.ts
│   └── order-item.entity.ts
├── auth/              # Authentication module
│   ├── dto/
│   ├── guards/
│   ├── strategies/
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   └── auth.module.ts
├── users/             # Users module
├── categories/        # Categories module
├── products/          # Products module
├── orders/            # Orders module
├── common/            # Common utilities
│   ├── dto/
│   └── decorators/
└── config/            # Configuration files
```

## Cài đặt

1. Cài đặt dependencies:
```bash
npm install
```

2. Tạo file `.env` từ `.env.example`:
```bash
cp .env.example .env
```

3. Cấu hình database trong file `.env`:
```
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=7d
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

4. Chạy ứng dụng:
```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

## API Documentation

Sau khi chạy server, truy cập Swagger UI tại:
```
http://localhost:3000/api
```

## Các tính năng chính

### 1. Authentication (Auth)
- Đăng ký tài khoản (`POST /auth/register`)
- Đăng nhập (`POST /auth/login`)
- JWT token authentication

### 2. Users
- Quản lý người dùng (Admin only)
- Xem và cập nhật profile
- Phân quyền: Admin và User

### 3. Categories
- CRUD danh mục sản phẩm
- Public: Xem danh sách
- Admin: Tạo, cập nhật, xóa

### 4. Products
- CRUD sản phẩm
- Tìm kiếm và lọc theo danh mục
- Phân trang
- Quản lý số lượng và trạng thái

### 5. Orders
- Tạo đơn hàng
- Quản lý trạng thái đơn hàng (pending, confirmed, rented, returned, cancelled)
- Tính toán giá và tiền cọc tự động
- Quản lý số lượng sản phẩm khi đặt hàng

## Database Schema

### User
- id, email, password, fullName, phone, address
- role (admin/user), isActive

### Category
- id, name, description, image, isActive

### Product
- id, name, description, images, price, deposit
- quantity, size, color, brand
- isAvailable, isActive
- categoryId (foreign key)

### Order
- id, orderNumber, status
- totalPrice, totalDeposit
- rentalStartDate, rentalEndDate
- rentalAddress, notes
- userId (foreign key)

### OrderItem
- id, quantity, price, deposit
- orderId, productId (foreign keys)

## Security

- Password được hash bằng bcrypt
- JWT authentication với Bearer token
- Role-based access control (RBAC)
- Input validation với class-validator
- CORS enabled

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| DATABASE_URL | PostgreSQL connection string | - |
| JWT_SECRET | Secret key for JWT | - |
| JWT_EXPIRES_IN | JWT expiration time | 7d |
| PORT | Server port | 3000 |
| NODE_ENV | Environment | development |
| FRONTEND_URL | Frontend URL for CORS | http://localhost:3000 |

## Scripts

- `npm run start` - Start server
- `npm run start:dev` - Start in development mode with watch
- `npm run start:prod` - Start in production mode
- `npm run build` - Build for production
- `npm run test` - Run tests
- `npm run lint` - Run linter
