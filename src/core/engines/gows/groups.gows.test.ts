import {
  selectDefaultSubGroupId,
  ToGroupInfo,
  ToSubGroupInfo,
} from '@waha/core/engines/gows/groups.gows';
import { SubGroupInfo } from '@waha/structures/groups.dto';
import {
  GOWSSubGroup,
  GroupInfoFull,
} from '@waha/core/engines/gows/types.group';

function baseGroup(): GroupInfoFull {
  return {
    JID: '123@g.us',
    OwnerJID: '456@s.whatsapp.net',
    Name: 'Group Name',
    Topic: 'Group Description',
    IsLocked: false,
    IsAnnounce: false,
    Participants: [],
    MemberAddMode: 'all_member_add',
    MemberShareHistoryMode: 'all_member_share',
    IsJoinApprovalRequired: false,
  };
}

describe('ToGroupInfo', () => {
  it('maps community parent fields', () => {
    const group = baseGroup();
    group.IsParent = true;
    group.LinkedParentJID = '';
    group.IsDefaultSubGroup = false;
    const info = ToGroupInfo(group);
    expect(info.isParent).toBe(true);
    expect(info.linkedParentId).toBeUndefined();
    expect(info.isDefaultSubGroup).toBe(false);
  });

  it('maps subgroup fields', () => {
    const group = baseGroup();
    group.IsParent = false;
    group.LinkedParentJID = '111@g.us';
    group.IsDefaultSubGroup = true;
    const info = ToGroupInfo(group);
    expect(info.isParent).toBe(false);
    expect(info.linkedParentId).toBe('111@g.us');
    expect(info.isDefaultSubGroup).toBe(true);
  });

  it('treats absent community fields as undefined (backward-compat)', () => {
    const info = ToGroupInfo(baseGroup());
    expect(info.isParent).toBeUndefined();
    expect(info.linkedParentId).toBeUndefined();
    expect(info.isDefaultSubGroup).toBeUndefined();
  });
});

function baseSubGroup(): GOWSSubGroup {
  return {
    JID: '789@g.us',
    Name: 'Subgroup',
    NameSetAt: '2026-01-01T00:00:00Z',
    NameSetBy: '456@s.whatsapp.net',
    NameSetByPN: '456@s.whatsapp.net',
    IsDefaultSubGroup: false,
  };
}

describe('ToSubGroupInfo', () => {
  it('maps id, name and default-subgroup flag', () => {
    const subGroup = baseSubGroup();
    subGroup.IsDefaultSubGroup = true;
    expect(ToSubGroupInfo(subGroup)).toEqual({
      id: '789@g.us',
      name: 'Subgroup',
      isDefaultSubGroup: true,
    });
  });

  it('defaults absent flag to false', () => {
    const subGroup = baseSubGroup();
    delete subGroup.IsDefaultSubGroup;
    expect(ToSubGroupInfo(subGroup as GOWSSubGroup)).toEqual({
      id: '789@g.us',
      name: 'Subgroup',
      isDefaultSubGroup: false,
    });
  });
});

function subGroupInfo(
  id: string,
  isDefaultSubGroup: boolean,
): SubGroupInfo {
  return { id: id, name: `Subgroup ${id}`, isDefaultSubGroup };
}

describe('selectDefaultSubGroupId', () => {
  it('returns the default subgroup id', () => {
    expect(
      selectDefaultSubGroupId([
        subGroupInfo('111@g.us', false),
        subGroupInfo('222@g.us', true),
      ]),
    ).toBe('222@g.us');
  });

  it('returns undefined when no subgroup is default', () => {
    expect(
      selectDefaultSubGroupId([
        subGroupInfo('111@g.us', false),
        subGroupInfo('222@g.us', false),
      ]),
    ).toBeUndefined();
  });

  it('returns undefined for an empty list', () => {
    expect(selectDefaultSubGroupId([])).toBeUndefined();
  });
});
