import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { AdminStubGuard } from './admin.guard';
import {
  MAX_IMAGE_BYTES,
  ProductImagesService,
  type UploadedImageFile,
} from './product-images.service';

/** Multer `limits` estoura como MulterError (500 default) — mapeia p/ 400. */
@Catch()
export class ImageUploadExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const code = (exception as { code?: string } | null)?.code;
    if (code === 'LIMIT_FILE_SIZE' || code === 'LIMIT_UNEXPECTED_FILE') {
      const res = host.switchToHttp().getResponse<Response>();
      res.status(400).json({
        message: code === 'LIMIT_FILE_SIZE' ? 'imagem excede 5MB' : 'apenas um arquivo (campo "file")',
        code: 'BAD_REQUEST',
      });
      return;
    }
    throw exception;
  }
}

// Galeria do produto. Leitura aberta; escrita exige admin (stub x-role).
// Upload: multipart campo "file", image/* até 5MB (multer memory;
// o service grava em PRODUCT_IMAGES_DIR com filename `uuid+ext`).
@Controller('products')
export class ProductImagesController {
  constructor(private readonly images: ProductImagesService) {}

  @Post(':code/images')
  @HttpCode(201)
  @UseGuards(AdminStubGuard)
  @UseFilters(new ImageUploadExceptionFilter())
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        const mime = String(file?.mimetype ?? '').toLowerCase();
        if (!mime.startsWith('image/')) {
          cb(new BadRequestException('apenas image/* (campo "file")'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  upload(@Param('code') code: string, @UploadedFile() file?: UploadedImageFile) {
    if (!file || file.buffer === undefined) {
      throw new BadRequestException('arquivo ausente (campo "file")');
    }
    return this.images.saveImage(code, file);
  }

  @Get(':code/images')
  list(@Param('code') code: string) {
    return this.images.listImages(code);
  }

  @Delete(':code/images/:id')
  @UseGuards(AdminStubGuard)
  remove(@Param('code') code: string, @Param('id') id: string) {
    return this.images.removeImage(code, id);
  }
}

// Stream público dos bytes (`GET /v1/product-images/:filename`).
// Content-Type/Length do metadado + `Cache-Control: public, max-age=86400`.
@Controller('product-images')
export class ProductImageFileController {
  constructor(private readonly images: ProductImagesService) {}

  @Get(':filename')
  @Header('Cache-Control', 'public, max-age=86400')
  async stream(@Param('filename') filename: string, @Res() res: Response): Promise<void> {
    const { stream, mime, size } = await this.images.openImageStream(filename);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(size));
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).json({ message: 'imagem não encontrada' });
      else res.end();
    });
    stream.pipe(res);
  }
}
