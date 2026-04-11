import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

export enum UserGender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
}

export enum PrivacyShowPhone {
  ALL = 'ALL',
  FRIEND = 'FRIEND',
  PRIVATE = 'PRIVATE',
}

@Schema({ _id: false })
export class UserStatus {
  @Prop({ type: Boolean, default: false })
  isOnline: boolean;

  @Prop({ type: Date, default: null })
  lastSeen: Date | null;
}
export const UserStatusMongoSchema = SchemaFactory.createForClass(UserStatus);

@Schema({ _id: false })
export class UserPrivacy {
  @Prop({
    type: String,
    enum: Object.values(PrivacyShowPhone),
    default: PrivacyShowPhone.FRIEND,
  })
  showPhone: PrivacyShowPhone;

  @Prop({ type: Boolean, default: true })
  showOnline: boolean;

  @Prop({ type: Boolean, default: false })
  allowStrangerMessage: boolean;

  @Prop({ type: Boolean, default: true })
  findByPhone: boolean;
}
export const UserPrivacyMongoSchema = SchemaFactory.createForClass(UserPrivacy);

@Schema({ _id: false })
export class UserSettings {
  @Prop({ type: Boolean, default: true })
  darkMode: boolean;

  @Prop({ type: String, default: 'vi' })
  language: string;

  @Prop({ type: Boolean, default: false })
  twoFactorAuth: boolean;
}
export const UserSettingsMongoSchema = SchemaFactory.createForClass(UserSettings);

@Schema({
  collection: 'users',
  timestamps: true,
})
export class User {
  @Prop({ required: true, unique: true, trim: true })
  phone: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  })
  email: string;

  /** bcrypt hash */
  @Prop({ required: true, select: false })
  password: string;

  @Prop({ required: true, trim: true })
  fullName: string;

  @Prop({ type: String, default: '' })
  avatar: string;

  @Prop({ type: String, default: '' })
  coverImage: string;

  @Prop({ type: Date, default: null })
  dob: Date | null;

  @Prop({
    type: String,
    enum: Object.values(UserGender),
    default: UserGender.OTHER,
  })
  gender: UserGender;

  @Prop({ type: String, default: '' })
  bio: string;

  @Prop({
    type: UserStatusMongoSchema,
    default: () => ({ isOnline: false, lastSeen: null }),
  })
  status: UserStatus;

  @Prop({
    type: UserPrivacyMongoSchema,
    default: () => ({
      showPhone: PrivacyShowPhone.FRIEND,
      showOnline: true,
      allowStrangerMessage: false,
      findByPhone: true,
    }),
  })
  privacy: UserPrivacy;

  @Prop({
    type: UserSettingsMongoSchema,
    default: () => ({
      darkMode: true,
      language: 'vi',
      twoFactorAuth: false,
    }),
  })
  settings: UserSettings;

  @Prop({ type: [String], default: [] })
  fcmTokens: string[];

  @Prop({ type: Boolean, default: false })
  isVerified: boolean;

  @Prop({ type: Boolean, default: false })
  isBlocked: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);

/** unique đã khai báo @Prop(unique: true) — tương đương createIndex phone/email unique */
UserSchema.index({ 'status.isOnline': 1 });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ isBlocked: 1, createdAt: -1 });
UserSchema.index({ isVerified: 1, createdAt: -1 });
