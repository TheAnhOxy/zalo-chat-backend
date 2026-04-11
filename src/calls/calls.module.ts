import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Call, CallSchema } from './schemas/call.schema';
import { CallsService } from './calls.service';
import { CallsController } from './calls.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Call.name, schema: CallSchema }]),
  ],
  controllers: [CallsController],
  providers: [CallsService],
  exports: [CallsService, MongooseModule],
})
export class CallsModule {}
