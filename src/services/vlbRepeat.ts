export function activationOnRepeat(
  status: string
): 'return_existing' | 'proceed' | 'declined' {
  if (status === 'activated') return 'return_existing';
  if (status === 'declined') return 'declined';
  return 'proceed';
}

export function settleOnRepeat(status: string): 'return_existing' | 'proceed' | 'invalid' {
  if (status === 'settled') return 'return_existing';
  if (status === 'settlement') return 'proceed';
  return 'invalid';
}

export function renewOnRepeat(status: string): 'return_existing' | 'proceed' | 'invalid' {
  if (status === 'renewed') return 'return_existing';
  if (status === 'settlement') return 'proceed';
  return 'invalid';
}
