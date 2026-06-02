# Comprehensive Affiliate API Test Script
# Tests all Phase 1-3 endpoints

param(
    [string]$BaseUrl = "http://localhost:3000/api/affiliate",
    [string]$Token = "your_bearer_token_here"
)

$ErrorCount = 0
$SuccessCount = 0

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Method,
        [string]$Endpoint,
        [object]$Body,
        [int]$ExpectedStatus = 200
    )
    
    Write-Host "`n[TEST] $Name" -ForegroundColor Cyan
    Write-Host "  $Method $Endpoint" -ForegroundColor Gray
    
    try {
        $Uri = "$BaseUrl$Endpoint"
        $Headers = @{
            "Authorization" = "Bearer $Token"
            "Content-Type" = "application/json"
        }
        
        $Params = @{
            Uri = $Uri
            Method = $Method
            Headers = $Headers
        }
        
        if ($Body) {
            $Params["Body"] = $Body | ConvertTo-Json
        }
        
        $Response = Invoke-WebRequest @Params -ErrorAction Stop
        
        if ($Response.StatusCode -eq $ExpectedStatus) {
            Write-Host "  ✓ PASS ($($Response.StatusCode))" -ForegroundColor Green
            $global:SuccessCount++
            return $Response.Content | ConvertFrom-Json
        } else {
            Write-Host "  ✗ FAIL - Expected $ExpectedStatus, got $($Response.StatusCode)" -ForegroundColor Red
            $global:ErrorCount++
            return $null
        }
    } catch {
        Write-Host "  ✗ ERROR: $($_.Exception.Message)" -ForegroundColor Red
        $global:ErrorCount++
        return $null
    }
}

Write-Host "===================================================" -ForegroundColor Yellow
Write-Host "AFFILIATE API TEST SUITE - PHASE 1-3" -ForegroundColor Yellow
Write-Host "===================================================" -ForegroundColor Yellow
Write-Host "Base URL: $BaseUrl" -ForegroundColor Gray
Write-Host "Token: ${Token:0:20}..." -ForegroundColor Gray

# ========== CRITICAL FIXES - PHASE 1 TESTS ==========
Write-Host "`n▓▓▓ PHASE 1: CRITICAL FIXES ▓▓▓" -ForegroundColor Magenta

# Test 1: Get payouts summary (FIX #2)
$PayoutSummary = Test-Endpoint `
    -Name "Get Payouts Summary" `
    -Method "GET" `
    -Endpoint "/payouts/summary"

if ($PayoutSummary) {
    Write-Host "  Response: total_requested=$($PayoutSummary.data.totalRequested), pending=$($PayoutSummary.data.pendingPayouts)" -ForegroundColor Gray
}

# Test 2: Get referral links (should show real stats, not zeros)
$Links = Test-Endpoint `
    -Name "Get Referral Links (Real Stats)" `
    -Method "GET" `
    -Endpoint "/links"

if ($Links -and $Links.data) {
    $FirstLink = $Links.data[0]
    if ($FirstLink) {
        Write-Host "  Response: clicks=$($FirstLink.clicks), conversions=$($FirstLink.conversions), earnings=$($FirstLink.earnings)" -ForegroundColor Gray
        if ($FirstLink.clicks -eq 0 -and $FirstLink.conversions -eq 0) {
            Write-Host "  ⓘ (Expected zero if no activity)" -ForegroundColor Gray
        }
    }
}

# Test 3: Get payout summary structure
if ($PayoutSummary -and $PayoutSummary.data) {
    $SummaryFields = @("totalRequested", "totalPaid", "pendingPayouts", "nextPayoutDate", "minimumPayout")
    Write-Host "`n[VERIFY] Payout Summary Fields" -ForegroundColor Cyan
    foreach ($field in $SummaryFields) {
        if ($PayoutSummary.data.PSObject.Properties.Name -contains $field) {
            Write-Host "  ✓ $field" -ForegroundColor Green
        } else {
            Write-Host "  ✗ $field (MISSING)" -ForegroundColor Red
            $global:ErrorCount++
        }
    }
}

# ========== HIGH PRIORITY ENDPOINTS - PHASE 2 TESTS ==========
Write-Host "`n▓▓▓ PHASE 2: HIGH PRIORITY TEST ENDPOINTS ▓▓▓" -ForegroundColor Magenta

# Test 4: Dashboard stats
$DashStats = Test-Endpoint `
    -Name "Get Dashboard Stats" `
    -Method "GET" `
    -Endpoint "/dashboard/stats"

if ($DashStats) {
    Write-Host "  Response: earnings=$($DashStats.data.totalEarnings), clicks=$($DashStats.data.totalClicks)" -ForegroundColor Gray
}

# Test 5: Get earnings
$Earnings = Test-Endpoint `
    -Name "Get Paginated Earnings" `
    -Method "GET" `
    -Endpoint "/earnings?page=1&limit=10"

if ($Earnings) {
    Write-Host "  Response: count=$($Earnings.data.Length), total=$($Earnings.total)" -ForegroundColor Gray
}

# Test 6: Get products
$Products = Test-Endpoint `
    -Name "Get Products with Commission" `
    -Method "GET" `
    -Endpoint "/products"

if ($Products) {
    Write-Host "  Response: products=$($Products.data.Length)" -ForegroundColor Gray
}

# ========== CHART EMPTY-STATE TESTS - PHASE 3 ==========
Write-Host "`n▓▓▓ PHASE 3: CHART EMPTY-STATE & PLACEHOLDER ▓▓▓" -ForegroundColor Magenta

# Test 7: Get chart data (real data)
$ChartData = Test-Endpoint `
    -Name "Get Chart Data (Real)" `
    -Method "GET" `
    -Endpoint "/dashboard/chart-data"

if ($ChartData) {
    $Labels = $ChartData.data.labels.Count
    $HasEmptyFlag = $ChartData.data.PSObject.Properties.Name -contains "isEmpty"
    $HasTypeFlag = $ChartData.data.PSObject.Properties.Name -contains "dataType"
    
    Write-Host "  Response: months=$Labels, isEmpty=$($ChartData.data.isEmpty), dataType=$($ChartData.data.dataType)" -ForegroundColor Gray
    Write-Host "  Message: $($ChartData.data.message)" -ForegroundColor Gray
    
    Write-Host "`n[VERIFY] Chart Data Structure (Real)" -ForegroundColor Cyan
    $ChartFields = @("labels", "earnings", "clicks", "conversions", "isEmpty", "dataType", "message")
    foreach ($field in $ChartFields) {
        if ($ChartData.data.PSObject.Properties.Name -contains $field) {
            Write-Host "  ✓ $field" -ForegroundColor Green
        } else {
            if ($field -in @("isEmpty", "dataType", "message")) {
                Write-Host "  ⚠ $field (Optional for real data)" -ForegroundColor Yellow
            } else {
                Write-Host "  ✗ $field (MISSING)" -ForegroundColor Red
                $global:ErrorCount++
            }
        }
    }
    
    # Verify data array lengths
    if ($ChartData.data.labels.Count -eq 12 -and $ChartData.data.earnings.Count -eq 12) {
        Write-Host "  ✓ Chart data has 12 months" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Chart data should have 12 months" -ForegroundColor Red
        $global:ErrorCount++
    }
}

# Test 8: Get chart data with placeholder
$PlaceholderChart = Test-Endpoint `
    -Name "Get Chart Data (Placeholder)" `
    -Method "GET" `
    -Endpoint "/dashboard/chart-data?showPlaceholder=true"

if ($PlaceholderChart) {
    Write-Host "  Response: dataType=$($PlaceholderChart.data.dataType), earnings=[0,0,0,150,450,1200...]" -ForegroundColor Gray
    Write-Host "  Message: $($PlaceholderChart.data.message)" -ForegroundColor Gray
    
    if ($PlaceholderChart.data.dataType -eq "placeholder") {
        Write-Host "  ✓ Placeholder mode active" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Placeholder mode not working correctly" -ForegroundColor Red
        $global:ErrorCount++
    }
    
    # Verify earnings pattern (should be realistic growth)
    $Earnings = $PlaceholderChart.data.earnings
    if ($Earnings[0] -eq 0 -and $Earnings[5] -gt 100) {
        Write-Host "  ✓ Placeholder shows realistic growth pattern" -ForegroundColor Green
    }
}

# ========== CORE FUNCTIONALITY TESTS ==========
Write-Host "`n▓▓▓ CORE FUNCTIONALITY ▓▓▓" -ForegroundColor Magenta

# Test 9: Get payment methods
$PaymentMethods = Test-Endpoint `
    -Name "Get Payment Methods" `
    -Method "GET" `
    -Endpoint "/payment-methods"

if ($PaymentMethods) {
    Write-Host "  Response: count=$($PaymentMethods.data.Length)" -ForegroundColor Gray
}

# Test 10: Get recent earnings
$RecentEarnings = Test-Endpoint `
    -Name "Get Recent Earnings" `
    -Method "GET" `
    -Endpoint "/dashboard/recent-earnings"

if ($RecentEarnings) {
    Write-Host "  Response: count=$($RecentEarnings.data.Length)" -ForegroundColor Gray
}

# Test 11: Get earnings summary
$EarningsSummary = Test-Endpoint `
    -Name "Get Earnings Summary" `
    -Method "GET" `
    -Endpoint "/earnings/summary"

if ($EarningsSummary) {
    Write-Host "  Response: approved=$($EarningsSummary.data.approved), pending=$($EarningsSummary.data.pending), paid=$($EarningsSummary.data.paid)" -ForegroundColor Gray
}

# Test 12: Get payouts
$Payouts = Test-Endpoint `
    -Name "Get Payouts" `
    -Method "GET" `
    -Endpoint "/payouts"

if ($Payouts) {
    Write-Host "  Response: count=$($Payouts.data.Length)" -ForegroundColor Gray
}

# ========== SUMMARY ==========
Write-Host "`n===================================================" -ForegroundColor Yellow
Write-Host "TEST SUMMARY" -ForegroundColor Yellow
Write-Host "===================================================" -ForegroundColor Yellow
Write-Host "✓ PASSED: $global:SuccessCount" -ForegroundColor Green
Write-Host "✗ FAILED: $global:ErrorCount" -ForegroundColor Red

if ($global:ErrorCount -eq 0) {
    Write-Host "`n🎉 ALL TESTS PASSED!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n⚠️ $global:ErrorCount test(s) failed" -ForegroundColor Yellow
    exit 1
}
