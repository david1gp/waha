import { validate } from 'class-validator';
import { UpdateChannelRequest } from '@waha/structures/channels.dto';

async function errorsOf(request: UpdateChannelRequest) {
  return validate(request);
}

function request(data: Record<string, any>): UpdateChannelRequest {
  return Object.assign(new UpdateChannelRequest(), data);
}

describe('UpdateChannelRequest', () => {
  it('accepts name only', async () => {
    expect(await errorsOf(request({ name: 'New' }))).toEqual([]);
  });

  it('accepts description only, including empty string (clears)', async () => {
    expect(await errorsOf(request({ description: '' }))).toEqual([]);
  });

  it('accepts null picture (removes)', async () => {
    expect(await errorsOf(request({ picture: null }))).toEqual([]);
  });

  it('accepts an empty update (engines reject it, not the DTO)', async () => {
    expect(await errorsOf(request({}))).toEqual([]);
  });

  it('rejects empty name', async () => {
    const errors = await errorsOf(request({ name: '' }));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('name');
  });

  it('rejects non-string description', async () => {
    const errors = await errorsOf(request({ description: 42 }));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('description');
  });
});
