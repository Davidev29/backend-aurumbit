import { Module } from '@nestjs/common';
import { AdminQueuesController } from './admin-queues.controller';

// Fase 6 (aditivo): agrupa endpoints administrativos (`/admin/*`, admin-only).
@Module({
  controllers: [AdminQueuesController],
})
export class AdminModule {}
