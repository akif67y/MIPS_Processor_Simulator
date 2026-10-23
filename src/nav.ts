// Every page of the site, in nav order, with the group the studio's section menu lists it under.
export type NavGroup = 'Single-cycle' | 'Pipelining' | 'Prediction'
export const NAV: { path: string; title: string; group: NavGroup }[] = [
  { path: 'pc-update', title: 'Next PC', group: 'Single-cycle' },
  { path: 'datapath', title: 'Datapath walk', group: 'Single-cycle' },
  { path: 'add-bne', title: '+ bne', group: 'Single-cycle' },
  { path: 'add-jr', title: '+ jr', group: 'Single-cycle' },
  { path: 'add-jal', title: '+ jal', group: 'Single-cycle' },
  { path: 'add-lui', title: '+ lui', group: 'Single-cycle' },
  { path: 'add-ori', title: '+ ori', group: 'Single-cycle' },
  { path: 'slt', title: 'slt', group: 'Single-cycle' },
  { path: 'forwarding', title: 'Forwarding', group: 'Pipelining' },
  { path: 'data-hazards', title: 'Data hazards', group: 'Pipelining' },
  { path: 'control-hazards', title: 'Control hazards', group: 'Pipelining' },
  { path: 'branch-prediction', title: 'Branch prediction', group: 'Prediction' },
]
export const NAV_GROUPS: NavGroup[] = ['Single-cycle', 'Pipelining', 'Prediction']
