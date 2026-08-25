# Telegram Notifications Specification

## Purpose

Send a Telegram message for each new job match, formatted with score, title, company, and link.

## Requirements

### Requirement: Send Notification Per Match

The system MUST send one Telegram Bot API message for each job that creates a Notion page.

**Message format**:
```
🎯 Nueva oferta con match ({score}/100)

{title} en {company}

{link}
```

**API contract**:
- Endpoint: `https://api.telegram.org/bot{BOT_TOKEN}/sendMessage`
- Method: POST
- Body: `{ "chat_id": "{CHAT_ID}", "text": "{formatted_message}", "parse_mode": "Markdown" }`

#### Scenario: Happy path — message sent

- GIVEN a job with score 92, title "Backend Engineer", company "TechCo", link "https://..."
- WHEN `telegramSendMessage()` is called
- THEN a POST is made to Telegram API
- AND the message contains `🎯 Nueva oferta con match (92/100)`
- AND the message contains `Backend Engineer en TechCo`
- AND the message contains the link

#### Scenario: Telegram API returns error

- GIVEN the Telegram API returns HTTP 4xx or 5xx
- WHEN the error is caught
- THEN the error is logged with the job title
- AND the pipeline continues (non-fatal)
- AND the Notion page (already created) is NOT rolled back

#### Scenario: Bot token or chat_id is missing

- GIVEN `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` is not set in Script Properties
- WHEN `telegramSendMessage()` is called
- THEN the function returns immediately without making an API call
- AND a warning is logged: credentials not configured

## Acceptance Criteria

- [ ] Message matches the specified format exactly
- [ ] One message per match (not batched)
- [ ] Telegram errors are non-fatal; pipeline continues
- [ ] Missing credentials produce a warning, not a crash
- [ ] Each send is logged with success/failure status
