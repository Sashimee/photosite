export const USER_ROLES = ['client', 'photographer', 'professional', 'admin'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['active', 'suspended', 'deleted'] as const;

export type UserStatus = (typeof USER_STATUSES)[number];
