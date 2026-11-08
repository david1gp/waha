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

import { WhatsappSessionNoWebCore } from '@waha/core/engines/noweb/session.noweb.core';
import type { NOWEBNewsletterMetadata } from '@waha/core/engines/noweb/noweb.newsletter';
import { ChannelRole } from '@waha/structures/channels.dto';

function baseMetadata(
  overrides: Partial<NOWEBNewsletterMetadata> = {},
): NOWEBNewsletterMetadata {
  return {
    id: '123@newsletter',
    state: 'ACTIVE',
    creation_time: 1,
    name: 'Channel Name',
    nameTime: 2,
    description: 'Channel Description',
    descriptionTime: 3,
    invite: 'INVITE123',
    handle: 'handle',
    picture: '/direct/pic',
    preview: '/direct/prev',
    reaction_codes: null,
    subscribers: 7,
    verification: 'VERIFIED',
    viewer_metadata: { role: 'ADMIN' },
    ...overrides,
  };
}

function rawNewsletter(name = 'Channel Name') {
  return {
    id: '123@newsletter',
    state: { type: 'ACTIVE' },
    thread_metadata: {
      creation_time: '1',
      name: { text: name, update_time: '2' },
      description: { text: 'Channel Description', update_time: '3' },
      invite: 'INVITE123',
      handle: 'handle',
      picture: null,
      preview: null,
      subscribers_count: '7',
      verification: 'VERIFIED',
    },
    viewer_metadata: { role: 'OWNER' },
  };
}

function nowebSession(sock: Record<string, any>): any {
  const session = Object.create(WhatsappSessionNoWebCore.prototype);
  session.sock = sock;
  // @Activity() decorator hook
  session.hooks = { activity: { promise: async () => {} } };
  return session;
}

describe('toChannel', () => {
  it('maps newsletter metadata fields', () => {
    const session = nowebSession({});
    expect(session.toChannel(baseMetadata())).toEqual({
      id: '123@newsletter',
      name: 'Channel Name',
      description: 'Channel Description',
      invite: 'https://whatsapp.com/channel/INVITE123',
      preview: 'https://pps.whatsapp.net/direct/prev',
      picture: 'https://pps.whatsapp.net/direct/pic',
      verified: true,
      role: 'ADMIN',
      subscribersCount: 7,
    });
  });

  it('falls back to view_role then GUEST', () => {
    const session = nowebSession({});
    expect(
      session.toChannel(baseMetadata({ viewer_metadata: { view_role: 'OWNER' } }))
        .role,
    ).toBe('OWNER');
    expect(
      session.toChannel(baseMetadata({ viewer_metadata: {} })).role,
    ).toBe(ChannelRole.GUEST);
  });

  it('maps null picture and preview to null', () => {
    const session = nowebSession({});
    const channel = session.toChannel(
      baseMetadata({ picture: null, preview: null }),
    );
    expect(channel.picture).toBeNull();
    expect(channel.preview).toBeNull();
  });
});

describe('channelsUpdateChannel', () => {
  function mockSock() {
    const calls: Array<[string, ...any[]]> = [];
    const record =
      (name: string) =>
      (...args: any[]) => {
        calls.push([name, ...args]);
        return Promise.resolve({});
      };
    const sock = {
      newsletterUpdateName: jest.fn(record('name')),
      newsletterUpdateDescription: jest.fn(record('description')),
      newsletterUpdatePicture: jest.fn(record('picture')),
      newsletterRemovePicture: jest.fn(record('remove')),
      newsletterMetadata: jest.fn(async () => rawNewsletter('New')),
    };
    return { sock, calls };
  }

  it('rejects empty updates with 422 without calling the server', async () => {
    const { sock, calls } = mockSock();
    const session = nowebSession(sock);
    await expect(
      session.channelsUpdateChannel('123@newsletter', {}),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(calls).toEqual([]);
    expect(sock.newsletterMetadata).not.toHaveBeenCalled();
  });

  it('updates name and re-gets the channel', async () => {
    const { sock, calls } = mockSock();
    const session = nowebSession(sock);
    const channel = await session.channelsUpdateChannel('123@newsletter', {
      name: 'New',
    });
    expect(calls).toEqual([['name', '123@newsletter', 'New']]);
    expect(sock.newsletterMetadata).toHaveBeenCalledWith(
      'jid',
      '123@newsletter',
    );
    expect(channel.name).toBe('New');
    expect(channel.role).toBe('OWNER');
  });

  it('updates description (empty string clears)', async () => {
    const { sock, calls } = mockSock();
    const session = nowebSession(sock);
    await session.channelsUpdateChannel('123@newsletter', { description: '' });
    expect(calls).toEqual([['description', '123@newsletter', '']]);
  });

  it('removes picture for null', async () => {
    const { sock, calls } = mockSock();
    const session = nowebSession(sock);
    await session.channelsUpdateChannel('123@newsletter', { picture: null });
    expect(calls).toEqual([['remove', '123@newsletter']]);
  });

  it('uploads picture for data file', async () => {
    const { sock, calls } = mockSock();
    const session = nowebSession(sock);
    const data = Buffer.from('imgbytes').toString('base64');
    await session.channelsUpdateChannel('123@newsletter', {
      picture: { mimetype: 'image/jpeg', filename: 'p.jpg', data: data },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('picture');
    expect(calls[0][1]).toBe('123@newsletter');
    expect(Buffer.from(calls[0][2]).toString()).toBe('imgbytes');
  });
});
