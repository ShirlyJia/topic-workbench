export const topicDirections = [
  ['base', '基础问题'],
  ['agent', 'Agent 系列问题'],
  ['business', '业务系列问题']
];

export const topicDirectionLabel = value => topicDirections.find(([key]) => key === value)?.[1] || '';
