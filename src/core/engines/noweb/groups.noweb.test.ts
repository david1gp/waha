import type { GroupMetadata } from '@adiwajshing/baileys';
import {
  selectAnnouncementSubGroupId,
  ToGroupInfo,
} from '@waha/core/engines/noweb/groups.noweb';

function baseMetadata(): GroupMetadata {
  return {
    id: '123@g.us',
    owner: '456@s.whatsapp.net',
    subject: 'Group Name',
    desc: 'Group Description',
    participants: [],
  };
}

describe('ToGroupInfo', () => {
  it('maps community parent fields', () => {
    const group = baseMetadata();
    group.isCommunity = true;
    const info = ToGroupInfo(group);
    expect(info.isParent).toBe(true);
    expect(info.linkedParentId).toBeUndefined();
    expect(info.isDefaultSubGroup).toBeUndefined();
  });

  it('maps subgroup fields', () => {
    const group = baseMetadata();
    group.isCommunity = false;
    group.linkedParent = '111@g.us';
    group.isCommunityAnnounce = true;
    const info = ToGroupInfo(group);
    expect(info.isParent).toBe(false);
    expect(info.linkedParentId).toBe('111@g.us');
    expect(info.isDefaultSubGroup).toBe(true);
  });

  it('treats absent community fields as undefined (backward-compat)', () => {
    const info = ToGroupInfo(baseMetadata());
    expect(info.isParent).toBeUndefined();
    expect(info.linkedParentId).toBeUndefined();
    expect(info.isDefaultSubGroup).toBeUndefined();
  });
});

function announceMetadata(
  id: string,
  isCommunityAnnounce?: boolean,
): Partial<GroupMetadata> {
  return { id: id, subject: `Subgroup ${id}`, isCommunityAnnounce };
}

describe('selectAnnouncementSubGroupId', () => {
  it('returns the announce subgroup id', () => {
    expect(
      selectAnnouncementSubGroupId([
        announceMetadata('111@g.us', false),
        announceMetadata('222@g.us', true),
      ]),
    ).toBe('222@g.us');
  });

  it('returns undefined when no subgroup is announce', () => {
    expect(
      selectAnnouncementSubGroupId([
        announceMetadata('111@g.us', false),
        announceMetadata('222@g.us'),
      ]),
    ).toBeUndefined();
  });

  it('returns undefined for an empty list', () => {
    expect(selectAnnouncementSubGroupId([])).toBeUndefined();
  });
});
