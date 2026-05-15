# 废弃文件目录
# 这些文件已被新架构取代，可以安全删除

## 废弃内容

### V1 工作流 (被 V2 取代)
- `workflows/ZombieHunterWorkflow.ts` - 被 opportunity-radar 取代
- `NewsAggregatorWorkflow.ts` - 被 opportunity-radar 取代
- `TwitterWorkflow.ts` - 被 opportunity-radar 取代
- `scripts/aiNewsReporter.ts` - 被 opportunity-radar 取代

### V2 子项目 (已移至主目录)
- `opportunity-radar/` - 已恢复到项目根目录

### 编译产物
- `opportunity_scanner.js` - TypeScript 编译产物

## 如何彻底删除

```bash
# 在项目根目录执行
rm -rf deprecated/
```

## 保留原因

保留在此目录是为了方便恢复，如需彻底清理请手动删除。
