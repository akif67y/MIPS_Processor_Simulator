export type Example = { name: string; goal: string; code: string; registers: string; memory: string }
const registers = '$1=100, $2=30, $3=20, $4=4, $5=15, $6=12, $7=24\n$t0=256, $t1=7, $t2=3, $s0=512'
const memory = '120=42, 256=9, 260=13, 264=21, 512=100'
const example = (name: string, goal: string, code: string, initial = registers): Example => ({ name, goal, code, registers: initial, memory })
export const EXAMPLES: Example[] = [
  example('Load-use: freeze & bubble', 'Follow detection in cycle 3, a bubble in EX in cycle 4, and MEM/WB forwarding in cycle 5. PC and IF/ID hold while older instructions advance.', 'lw $2, 20($1)\nand $4, $2, $5\nor $8, $2, $6\nadd $9, $4, $2\nslt $1, $6, $7'),
  example('EX/MEM → A', 'An adjacent ALU producer forwards its result to the next instruction’s rs operand. No stall.', 'add $s1, $t1, $t2\nsub $s2, $s1, $t2'),
  example('EX/MEM → B', 'The next instruction needs the producer’s value at its rt input: ForwardB = 10.', 'add $s1, $t1, $t2\nsub $s2, $t1, $s1'),
  example('MEM/WB → A and B', 'One independent instruction separates producer and consumer. Both inputs take the older result from MEM/WB.', 'add $s1, $t1, $t2\nadd $s3, $t1, $t1\nsub $s2, $s1, $s1'),
  example('Two sources at once', 'ForwardA = 01 and ForwardB = 10 in the same cycle: each ALU input has an independent multiplexer.', 'add $s1, $t1, $t2\nsub $s2, $t1, $t2\nadd $s3, $s1, $s2'),
  example('Newest writer wins', 'The slide 63 example: 10 → 40 → 60 → 64. When both pipeline registers match, EX/MEM wins over MEM/WB.', 'add $1, $1, $2\nadd $1, $1, $3\nadd $1, $1, $4', '$1=10, $2=30, $3=20, $4=4'),
  example('Load → operand B', 'The load-use detector must check rt as well as rs. After one bubble, ForwardB selects the loaded value.', 'lw $s1, 0($t0)\nsub $s2, $t1, $s1'),
  example('Load with a gap', 'The intervening instruction gives memory enough time. MEM/WB supplies the load result without a stall.', 'lw $s1, 0($t0)\nadd $s3, $t1, $t2\nadd $s2, $s1, $t2'),
  example('WB first, ID second', 'In cycle 5, I1 writes $s1 in the first half. I4 reads the new value in the second half, so it needs no forwarding later.', 'add $s1, $t1, $t2\nnop\nnop\nadd $s2, $s1, $s1'),
  example('ALU → store data', 'ForwardB supplies store data before ALUSrc chooses the immediate for address calculation. The data is carried in EX/MEM.', 'add $s1, $t1, $t2\nsw $s1, 4($t0)'),
  example('Load → store data', 'The extra MEM/WB → memory write-data path allows a memory copy with no stall. The load’s address is never forwarded as its data.', 'lw $s1, 0($t0)\nsw $s1, 4($t0)'),
  example('Load → store base', 'The store needs its base in EX, so this dependency still requires one stall.', 'lw $s1, 0($s0)\nsw $t1, 0($s1)'),
  example('ALU → store base', 'An ALU-generated address can go directly from EX/MEM into the store’s address calculation.', 'add $s1, $t0, $zero\nsw $t1, 4($s1)'),
  example('Ignore destinations & $zero', 'An immediate’s rt is a destination, not a source. A write to $zero cannot create a forwarding hazard.', 'lw $t1, 0($t0)\naddi $t1, $zero, 5\nadd $zero, $t1, $t1\nadd $s1, $zero, $t1'),
  example('Slide 53 dependency chain', 'Watch EX/MEM, MEM/WB, same-cycle register-file reads, and an ordinary later read in one trace.', 'sub $2, $1, $3\nand $12, $2, $5\nor $13, $6, $2\nadd $14, $2, $2\nsw $15, 100($2)', '$1=30, $3=50, $5=15, $6=12, $15=99'),
]
