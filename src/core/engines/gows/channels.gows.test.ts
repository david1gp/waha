import { UnprocessableEntityException } from '@nestjs/common';

// Baileys is ESM-only and can not be loaded under ts-jest (CommonJS).
// The paths below only cover value imports of the session core under test.
jest.mock('@adiwajshing/baileys', () => {
  const fn: any = (..._args: any[]) => undefined;
  return new Proxy(fn, {
    get: (_t, prop) => {
      if (prop === '__esModule') {
        return true;
      }
      if (prop === 'default') {
        return fn;
      }
      return fn;
    },
    apply: () => undefined,
  });
});

jest.mock('@adiwajshing/baileys/lib/WABinary/jid-utils', () => ({
  isLidUser: () => false,
}));
jest.mock('@adiwajshing/baileys/lib/Types/Label', () => ({}));
jest.mock('@adiwajshing/baileys/lib/Types/LabelAssociation', () => ({}));
jest.mock('file-type', () => ({}));

import { WhatsappSessionGoWSCore } from '@waha/core/engines/gows/session.gows.core';
import { messages } from '@waha/core/engines/gows/grpc/gows';
import { ChannelRole } from '@waha/structures/channels.dto';

function gowsSession(extra: Record<string, any> = {}): any {
  const session = Object.create(WhatsappSessionGoWSCore.prototype);
  session.session = new messages.Session({ id: 'test' });
  session.me = { id: 'me@s.whatsapp.net' };
  // @Activity() decorator hook
  session.hooks = { activity: { promise: async () => {} } };
  Object.assign(session, extra);
  return session;
}

function baseNewsletter(
  overrides: Record<string, any> = {},
): messages.Newsletter {
  return {
    id: '123@newsletter',
    role: 'OWNER',
    name: 'Channel Name',
    description: 'Channel Description',
    invite: 'INVITE123',
    picture: 'https://example.com/picture.jpg',
    preview: 'https://example.com/preview.jpg',
    verified: true,
    subscriberCount: 42,
    ...overrides,
  } as unknown as messages.Newsletter;
}

describe('toChannel', () => {
  it('maps newsletter fields', () => {
    const session = gowsSession();
    expect(session.toChannel(baseNewsletter())).toEqual({
      id: '123@newsletter',
      name: 'Channel Name',
      description: 'Channel Description',
      invite: 'https://whatsapp.com/channel/INVITE123',
      picture: 'https://example.com/picture.jpg',
      preview: 'https://example.com/preview.jpg',
      verified: true,
      role: ChannelRole.OWNER,
      subscribersCount: 42,
    });
  });

  it('uppercases lowercase roles', () => {
    const session = gowsSession();
    expect(session.toChannel(baseNewsletter({ role: 'admin' })).role).toBe(
      ChannelRole.ADMIN,
    );
  });

  it('defaults missing role to GUEST', () => {
    const session = gowsSession();
    const newsletter = baseNewsletter();
    delete (newsletter as any).role;
    expect(session.toChannel(newsletter).role).toBe(ChannelRole.GUEST);
  });
});

describe('setReaction on newsletters', () => {
  it('rejects non-numeric ids with 422 without calling the server', async () => {
    let called = false;
    const session = gowsSession({
      client: {
        SendReaction: () => {
          called = true;
        },
      },
    });
    await expect(
      session.setReaction({
        messageId: 'false_123@newsletter_ABCDEF',
        reaction: '👍',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(called).toBe(false);
  });

  it('forwards the numeric server id as messageId', async () => {
    let captured: any = null;
    const session = gowsSession({
      client: {
        SendReaction: (req: any, cb: any) => {
          captured = req;
          cb(null, { toObject: () => ({ id: 'NEWMSG', message: null }) });
        },
      },
    });
    const result = await session.setReaction({
      messageId: 'false_123@newsletter_456',
      reaction: '👍',
    });
    expect(captured.jid).toBe('123@newsletter');
    expect(captured.messageId).toBe('456');
    expect(captured.reaction).toBe('👍');
    expect(result.id).toBeDefined();
  });
});

describe('channelsDeleteChannel', () => {
  it('sends the JID to DeleteNewsletter', async () => {
    let captured: any = null;
    const session = gowsSession({
      client: {
        DeleteNewsletter: (req: any, cb: any) => {
          captured = req;
          cb(null, { toObject: () => ({}) });
        },
      },
    });
    await session.channelsDeleteChannel('123@newsletter');
    expect(captured.jid).toBe('123@newsletter');
  });
});

describe('channelsUpdateChannel', () => {
  function mockClient(newsletter: messages.Newsletter) {
    let captured: any = null;
    const calls: string[] = [];
    return {
      captured: () => captured,
      calls,
      client: {
        UpdateNewsletter: (req: any, cb: any) => {
          captured = req;
          calls.push('UpdateNewsletter');
          cb(null, { toObject: () => newsletter });
        },
      },
    };
  }

  it('rejects empty updates with 422 without calling the server', async () => {
    const mock = mockClient(baseNewsletter());
    const session = gowsSession({ client: mock.client });
    await expect(
      session.channelsUpdateChannel('123@newsletter', {}),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(mock.calls).toEqual([]);
  });

  it('sends name and description', async () => {
    const mock = mockClient(
      baseNewsletter({ name: 'New', description: 'New desc' }),
    );
    const session = gowsSession({ client: mock.client });
    const channel = await session.channelsUpdateChannel('123@newsletter', {
      name: 'New',
      description: 'New desc',
    });
    expect(mock.captured().name).toBe('New');
    expect(mock.captured().description).toBe('New desc');
    expect(mock.captured().has_picture).toBe(false);
    expect(channel.name).toBe('New');
  });

  it('sends remove_picture for null picture', async () => {
    const mock = mockClient(baseNewsletter());
    const session = gowsSession({ client: mock.client });
    await session.channelsUpdateChannel('123@newsletter', { picture: null });
    expect(mock.captured().remove_picture).toBe(true);
    expect(mock.captured().has_picture).toBe(false);
  });

  it('sends raw bytes for data picture', async () => {
    const mock = mockClient(baseNewsletter());
    const session = gowsSession({ client: mock.client });
    const data = Buffer.from('imgbytes').toString('base64');
    await session.channelsUpdateChannel('123@newsletter', {
      picture: { mimetype: 'image/jpeg', filename: 'p.jpg', data: data },
    });
    expect(Buffer.from(mock.captured().picture).toString()).toBe('imgbytes');
    expect(mock.captured().remove_picture).toBe(false);
  });
});
