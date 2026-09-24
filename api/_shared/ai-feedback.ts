import { createHmac } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  aiFeedbackInputSchema,
  type AiFeedbackInput,
  type TutorResponse,
} from '@easy-to-learn/domain';

import type { AiStateStore } from './ai-state.js';
import { ApiFault } from './fault.js';
import type { TutorActor } from './tutor-service.js';

export interface AiFeedbackRecord extends AiFeedbackInput {
  actorHash: string;
  model: string;
  promptVersion: string;
  schemaVersion: number;
}

export interface AiFeedbackStore {
  upsert(record: AiFeedbackRecord): Promise<boolean>;
}

export class AiFeedbackService {
  constructor(
    private readonly state: AiStateStore,
    private readonly store: AiFeedbackStore,
    private readonly actorHashSecret: string,
  ) {}

  async submit(actor: TutorActor, input: unknown): Promise<void> {
    const parsed = aiFeedbackInputSchema.safeParse(input);
    if (!parsed.success) throw new ApiFault('INVALID_INPUT', 'AI 反馈格式不正确');

    const actorKey = `${actor.kind}:${actor.id}`;
    const completed = await this.state.getCached(actorKey, parsed.data.requestId);
    if (!completed) {
      throw new ApiFault('INVALID_INPUT', '只能反馈当前身份最近完成的 AI 请求');
    }

    const accepted = await this.store.upsert(this.toRecord(actorKey, parsed.data, completed));
    if (!accepted) throw new ApiFault('INVALID_INPUT', '该 AI 请求不属于当前身份');
  }

  private toRecord(
    actorKey: string,
    input: AiFeedbackInput,
    completed: TutorResponse['data'],
  ): AiFeedbackRecord {
    return {
      ...input,
      actorHash: createHmac('sha256', this.actorHashSecret).update(actorKey).digest('hex'),
      model: completed.result.metadata.model,
      promptVersion: completed.result.metadata.promptVersion,
      schemaVersion: completed.result.schemaVersion,
    };
  }
}

export class SupabaseAiFeedbackStore implements AiFeedbackStore {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async upsert(record: AiFeedbackRecord): Promise<boolean> {
    const { data, error } = await this.client.rpc('upsert_ai_feedback', {
      p_request_id: record.requestId,
      p_actor_hash: record.actorHash,
      p_rating: record.rating,
      p_category: record.category ?? null,
      p_model: record.model,
      p_prompt_version: record.promptVersion,
      p_schema_version: record.schemaVersion,
    });
    if (error) throw new ApiFault('DEPENDENCY_UNAVAILABLE', 'AI 反馈服务暂时不可用');
    return data === true;
  }
}
