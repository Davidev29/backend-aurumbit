import { ArrayMinSize, IsArray, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ConsentDto {
  @IsIn(['TERMS', 'PRIVACY'])
  type!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  version!: string;
}

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => ConsentDto)
  consents!: ConsentDto[];

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceLabel?: string;
}

export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token!: string;
}

export class ResendVerificationDto {
  @IsEmail()
  email!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceLabel?: string;
}

export class RefreshDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  refreshToken?: string;

  /** Quando true, o refresh rotacionado também é gravado em cookie httpOnly. */
  @IsOptional()
  setCookie?: boolean;
}

export class ForgotDto {
  @IsEmail()
  email!: string;
}

export class ResetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class MfaVerifyDto {
  @IsOptional()
  @IsString()
  code?: string;

  /** Fluxo login step-up (sem Authorization): ticket retornado pelo login. */
  @IsOptional()
  @IsString()
  ticket?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceLabel?: string;
}
