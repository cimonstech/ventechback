# Test Affiliate API Routes (PowerShell)

This script tests the affiliate API endpoints to verify they are working correctly.

## Prerequisites
1. Server must be running on http://localhost:5000
2. You need a valid JWT token for an authenticated user with active affiliate status

## Test Commands

### 1. Test Route Mounting
```powershell
Invoke-RestMethod -Uri "http://localhost:5000/api/affiliate/test" -Method GET
```

### 2. Test with Authentication (replace YOUR_JWT_TOKEN)
```powershell
$headers = @{
    "Authorization" = "Bearer YOUR_JWT_TOKEN"
    "Content-Type" = "application/json"
}

# Get affiliate links
Invoke-RestMethod -Uri "http://localhost:5000/api/affiliate/links" -Method GET -Headers $headers

# Get earnings
Invoke-RestMethod -Uri "http://localhost:5000/api/affiliate/earnings" -Method GET -Headers $headers

# Get earnings summary
Invoke-RestMethod -Uri "http://localhost:5000/api/affiliate/earnings/summary" -Method GET -Headers $headers

# Generate affiliate link
$body = @{
    productId = "test-product-id"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:5000/api/affiliate/links/generate" -Method POST -Headers $headers -Body $body
```

## Expected Responses

### Route Test (/api/affiliate/test)
```json
{
  "success": true,
  "message": "Affiliate routes are working",
  "endpoints": {
    "links": "GET /api/affiliate/links",
    "earnings": "GET /api/affiliate/earnings",
    "earningsSummary": "GET /api/affiliate/earnings/summary",
    "generateLink": "POST /api/affiliate/links/generate"
  }
}
```

### Successful Affiliate Request
```json
{
  "success": true,
  "message": "Referral links retrieved successfully",
  "data": [...]
}
```

### Authentication Error (401)
```json
{
  "success": false,
  "message": "Unauthorized - No token provided"
}
```

### Affiliate Not Found (404)
```json
{
  "success": false,
  "message": "Affiliate not found"
}
```

## Debugging

### Check Server Logs
When making requests, look for these log messages:
```
🔍 AFFILIATE ROUTE: GET /api/affiliate/links
🔍 getLinks called for user: user-uuid
✅ Found affiliate: affiliate-uuid
✅ Retrieved links: 5
📤 SENDING SUCCESS RESPONSE: { success: true, ... }
```

### Common Issues

1. **404 Not Found**: Frontend calling wrong URL (missing `/api` prefix)
2. **401 Unauthorized**: Missing or invalid JWT token
3. **404 Affiliate not found**: User doesn't have active affiliate account
4. **500 Internal Error**: Database or service issues

### Frontend URL Fixes

If frontend is getting 404s, update service files:

```typescript
// WRONG - causes 404
const API_BASE = '/affiliate';

// CORRECT
const API_BASE = '/api/affiliate';
```

## Full Endpoint List

| Method | URL | Purpose |
|--------|-----|---------|
| GET | `/api/affiliate/test` | Test route availability |
| GET | `/api/affiliate/links` | Get affiliate links |
| GET | `/api/affiliate/earnings` | Get earnings (paginated) |
| GET | `/api/affiliate/earnings/summary` | Get earnings summary |
| POST | `/api/affiliate/links/generate` | Generate product affiliate link |
| GET | `/api/affiliate/dashboard/stats` | Dashboard statistics |
| GET | `/api/affiliate/dashboard/chart-data` | Chart data |
| GET | `/api/affiliate/dashboard/recent-earnings` | Recent earnings |

## Next Steps

1. Run the test commands above
2. Check server logs for debugging info
3. Update frontend URLs if needed
4. Verify authentication is working
5. Test with real affiliate data</content>
