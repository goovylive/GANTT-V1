import sys

path = 'src/components/DataAnalysis.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Let's find and replace target_p
# Let's define the exact lines
target_p_lines = [
    '                                            <div className="absolute top-1/2 -translate-y-1/2 -translate-x-full -ml-1 bg-rose-50 text-rose-700 text-[8px] font-black font-mono px-1 py-0.5 rounded border border-rose-200 shadow-3xs z-20 whitespace-nowrap uppercase tracking-wider">',
    '                                              P: {formatDuration(stats.mean)}{devPT !== null && ` (D.P/T: ${devPT >= 0 ? \'+\' : \'\'}${devPT.toFixed(1)}%)`}',
    '                                            </div>'
]

replacement_p_lines = [
    '                                            <div className="absolute top-1 -translate-x-1/2 bg-rose-50 text-rose-700 text-[8px] font-black font-mono px-1 py-0.5 rounded border border-rose-200 shadow-3xs z-20 whitespace-nowrap uppercase tracking-wider">',
    '                                              P: {formatDuration(stats.mean)}{devPT !== null && ` (${devPT >= 0 ? \'+\' : \'\'}${devPT.toFixed(2)}%)`}',
    '                                            </div>'
]

target_p_str = "\n".join(target_p_lines)
replacement_p_str = "\n".join(replacement_p_lines)

if target_p_str in content:
    content = content.replace(target_p_str, replacement_p_str)
    print("P replaced successfully!")
else:
    print("P target not found!")

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
