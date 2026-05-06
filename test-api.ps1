$ApiKey = "sk-kc0dc4j4RIkfUoixgEO4sBLgUrBbSabTUxCCahU5lCYi978r"
$ApiBase = "https://api1.link-ai.cc"

$headers = @{
    "Authorization" = "Bearer $ApiKey"
    "Content-Type" = "application/json"
}

Write-Host "=== Test 1: English Tweet Generation ===" -ForegroundColor Cyan

$body = @{
    model = "claude-opus-4-5-20251101"
    messages = @(
        @{role="system"; content="You are a social media copywriter. Generate engaging Twitter content. Output ONLY the tweet text, no explanations."}
        @{role="user"; content="Generate a short tweet about this AI news. Title: Anthropic Releases Claude 4 with Breakthrough Reasoning. Source: TechCrunch AI. Rules: Max 250 characters, Hook + value, 2-3 emojis, 1-2 hashtags."}
    )
    max_tokens = 300
    temperature = 0.8
} | ConvertTo-Json -Depth 5

$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)

try {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $resp = Invoke-RestMethod -Uri "$ApiBase/v1/chat/completions" -Headers $headers -Method POST -Body $bodyBytes -ContentType "application/json; charset=utf-8" -TimeoutSec 60
    $sw.Stop()
    Write-Host "English Tweet:" -ForegroundColor Green
    Write-Host $resp.choices[0].message.content
    Write-Host ("Time: {0}ms | Tokens: {1}" -f $sw.ElapsedMilliseconds, $resp.usage.total_tokens) -ForegroundColor Gray
} catch {
    Write-Host "Failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Test 2: Chinese Tweet Generation ===" -ForegroundColor Cyan

$cnBody = @{
    model = "claude-opus-4-5-20251101"
    messages = @(
        @{role="system"; content="You are a social media copywriter. Generate engaging Chinese tweets. Output ONLY the tweet text."}
        @{role="user"; content="根据这条AI新闻生成中文推文: 斯坦福团队发布开源多模态模型OpenSora 2.0，效果超越GPT-4V (来源: arXiv)。要求: 最多140字，开头有冲击力，2-3个emoji，1-2个hashtag。"}
    )
    max_tokens = 300
    temperature = 0.8
} | ConvertTo-Json -Depth 5

$cnBodyBytes = [System.Text.Encoding]::UTF8.GetBytes($cnBody)

try {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $resp = Invoke-RestMethod -Uri "$ApiBase/v1/chat/completions" -Headers $headers -Method POST -Body $cnBodyBytes -ContentType "application/json; charset=utf-8" -TimeoutSec 60
    $sw.Stop()
    Write-Host "Chinese Tweet:" -ForegroundColor Green
    Write-Host $resp.choices[0].message.content
    Write-Host ("Time: {0}ms | Tokens: {1}" -f $sw.ElapsedMilliseconds, $resp.usage.total_tokens) -ForegroundColor Gray
} catch {
    Write-Host "Failed: $($_.Exception.Message)" -ForegroundColor Red
}
