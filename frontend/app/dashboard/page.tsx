"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  ArrowRight,
  MessageCircle,
  ArrowLeftRight,
  Sparkles,
  TrendingUp,
  CreditCard,
  Settings,
  ChevronDown,
  RefreshCw,
  BarChart3,
  TrendingDown,
  Coins,
  Loader2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { LineChart as RechartsLineChart, Line, XAxis, YAxis, ResponsiveContainer } from "recharts"
import Link from "next/link"

// Types and interfaces
interface DashboardStats {
  tokenHoldings: number
  totalTransactions: number
  activeChains: number
  totalTokens: number
}

interface MarketData {
  data: Array<{
    prices: Array<{
      time: string
      price: string
    }>
  }>
}

interface LoadingStep {
  name: string
  status: "pending" | "loading" | "completed" | "error"
  message: string
}

// Solana-focused configuration (default selected)
const chainOptions = [{ name: "Solana", value: "501", label: "SOL" }]

const quickActions = [
  {
    id: "ai-chat",
    label: "AI Assistant",
    icon: MessageCircle,
    href: "/dashboard/ai-chat",
    gradientFrom: "#8B5CF6",
    gradientTo: "#6366F1",
  },
  {
    id: "swap",
    label: "Swap",
    icon: ArrowLeftRight,
    href: "/dashboard/swap",
    gradientFrom: "#EC4899",
    gradientTo: "#F43F5E",
  },
  {
    id: "portfolio",
    label: "Portfolio",
    icon: TrendingUp,
    href: "/dashboard/portfolio",
    gradientFrom: "#F59E0B",
    gradientTo: "#EF4444",
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    href: "/dashboard/settings",
    gradientFrom: "#10B981",
    gradientTo: "#059669",
  },
]

// Real Solana address for data fetching
const SOLANA_ADDRESS = "52C9T2T7JRojtxumYnYZhyUmrN7kqzvCLc4Ksvjk7TxD"

// Rate limiting manager
class DashboardRateLimitManager {
  private lastRequestTime = 0
  private minDelay = 3000 // 3 seconds between requests
  private maxRetries = 3

  async makeRequest(
    apiCall: () => Promise<any>,
    stepName: string,
    updateStep: (step: string, status: string, message: string) => void,
  ): Promise<any> {
    let retries = 0

    while (retries < this.maxRetries) {
      try {
        // Ensure minimum delay between requests
        const now = Date.now()
        const timeSinceLastRequest = now - this.lastRequestTime

        if (timeSinceLastRequest < this.minDelay) {
          const waitTime = this.minDelay - timeSinceLastRequest
          updateStep(stepName, "loading", `Waiting ${Math.ceil(waitTime / 1000)}s to prevent rate limiting...`)
          await new Promise((resolve) => setTimeout(resolve, waitTime))
        }

        updateStep(stepName, "loading", `Fetching ${stepName.toLowerCase()}...`)
        this.lastRequestTime = Date.now()

        const result = await apiCall()
        updateStep(stepName, "completed", `✅ ${stepName} loaded successfully`)
        return result
      } catch (error: any) {
        retries++

        if (error.message?.includes("429") || error.message?.includes("rate limit")) {
          const backoffDelay = Math.min(this.minDelay * Math.pow(2, retries), 15000) // Max 15s
          updateStep(
            stepName,
            "error",
            `Rate limited. Retrying in ${Math.ceil(backoffDelay / 1000)}s... (${retries}/${this.maxRetries})`,
          )
          await new Promise((resolve) => setTimeout(resolve, backoffDelay))
        } else if (retries >= this.maxRetries) {
          updateStep(stepName, "error", `❌ Failed to load ${stepName.toLowerCase()}`)
          throw error
        } else {
          updateStep(stepName, "error", `Retry ${retries}/${this.maxRetries} for ${stepName.toLowerCase()}...`)
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
      }
    }
  }
}

// Helper functions
function formatTimestamp(timestamp: string | number): string {
  const date = new Date(Number(timestamp))
  return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function formatPrice(price: string | number): string {
  const num = Number(price)
  if (num === 0) return "0.00"
  return num.toFixed(6)
}

// Filter functions for zero values with error handling
function filterNonZeroTokens(tokens: any[]): any[] {
  try {
    if (!Array.isArray(tokens)) return []

    return tokens.filter((token) => {
      try {
        const balance = Number(token?.balance || 0)
        const price = Number(token?.tokenPrice || 0)
        const value = balance * price
        return value > 0.01 && balance > 0 // Filter tokens worth less than $0.01
      } catch (error) {
        console.warn("Error filtering token:", token, error)
        return false
      }
    })
  } catch (error) {
    console.warn("Error in filterNonZeroTokens:", error)
    return []
  }
}

function filterNonZeroTransactions(transactions: any[]): any[] {
  try {
    if (!Array.isArray(transactions)) return []

    return transactions.filter((tx) => {
      try {
        const amount = Number(tx?.amount || 0)
        return Math.abs(amount) > 0 // Filter zero-amount transactions
      } catch (error) {
        console.warn("Error filtering transaction:", tx, error)
        return false
      }
    })
  } catch (error) {
    console.warn("Error in filterNonZeroTransactions:", error)
    return []
  }
}

// Market data API call function with error handling
async function callMarketDataApi(type: string, tokenName = "SOL") {
  const tokenContractAddress = "So11111111111111111111111111111111111111112" // SOL token address

  if (type === "total_token_balance") {
    const body = {
      address: SOLANA_ADDRESS,
      chains: "501",
      excludeRiskToken: "0",
    }
    const response = await fetch("/api/portfolio/total_token_balances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return await response.json()
  }

  if (type === "transaction_history") {
    const body = {
      address: SOLANA_ADDRESS,
      chains: "501",
      limit: "20",
    }
    const response = await fetch("/api/portfolio/history_by_add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return await response.json()
  }

  if (type === "token_value") {
    const body = {
      address: SOLANA_ADDRESS,
      chains: "501",
      excludeRiskToken: "0",
    }
    const response = await fetch("/api/portfolio/token_value", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return await response.json()
  }

  // Market data calls
  const body = {
    method: "GET",
    path: type === "hist_data" ? "/api/v5/dex/index/historical-price" : "/api/v5/dex/market/price",
    data: [
      {
        chainIndex: "501",
        tokenContractAddress,
      },
    ],
  }

  const response = await fetch("/api/market_data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  return await response.json()
}

// Chart component for SOL price history
function SolanaMarketChart({ data, title }: { data: MarketData; title: string }) {
  if (!data?.data?.[0]?.prices) return null

  const chartData = data.data[0].prices
    .map((item: any) => ({
      time: formatTimestamp(item.time),
      price: Number(item.price),
      timestamp: Number(item.time),
    }))
    .reverse()
    .slice(-24) // Show last 24 data points

  const currentPrice = chartData[chartData.length - 1]?.price || 0
  const previousPrice = chartData[chartData.length - 2]?.price || 0
  const priceChange = currentPrice - previousPrice
  const isPositive = priceChange >= 0

  return (
    <Card className="w-full bg-black/40 border-white/20 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-white flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          {title}
        </CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-white">${formatPrice(currentPrice)}</span>
          <span className={`flex items-center gap-1 text-sm ${isPositive ? "text-green-400" : "text-red-400"}`}>
            {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {isPositive ? "+" : ""}
            {formatPrice(priceChange)}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={{
            price: {
              label: "Price",
              color: "hsl(var(--chart-1))",
            },
          }}
          className="h-[200px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <RechartsLineChart data={chartData}>
              <XAxis
                dataKey="time"
                tick={{ fill: "white", fontSize: 10 }}
                axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                tickLine={{ stroke: "rgba(255,255,255,0.2)" }}
              />
              <YAxis
                tick={{ fill: "white", fontSize: 10 }}
                axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                tickLine={{ stroke: "rgba(255,255,255,0.2)" }}
                domain={["dataMin - 0.01", "dataMax + 0.01"]}
              />
              <ChartTooltip
                content={<ChartTooltipContent />}
                contentStyle={{
                  backgroundColor: "rgba(0,0,0,0.8)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "8px",
                  color: "white",
                }}
              />
              <Line
                type="monotone"
                dataKey="price"
                stroke="#9333ea"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "#9333ea" }}
              />
            </RechartsLineChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function DashboardCard({
  id,
  title,
  value,
  change,
  trend,
  icon: Icon,
  gradientFrom,
  gradientTo,
  loading = false,
}: any) {
  return (
    <div className="relative group">
      <div
        className="absolute inset-0 bg-gradient-to-r rounded-xl blur-sm opacity-20 group-hover:opacity-30 transition-opacity"
        style={{ backgroundImage: `linear-gradient(to right, ${gradientFrom}, ${gradientTo})` }}
      ></div>
      <div className="relative h-full backdrop-blur-sm bg-black/20 border border-white/10 rounded-xl p-6 overflow-hidden group-hover:border-white/20 transition-all group-hover:shadow-xl">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm text-white/60">{title}</p>
            <p className="text-2xl font-bold mt-1 text-white">
              {loading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-lg">Loading...</span>
                </div>
              ) : (
                value
              )}
            </p>
            <div className="flex items-center mt-1">
              <span
                className={`text-xs ${
                  trend === "up" ? "text-emerald-400" : trend === "down" ? "text-rose-400" : "text-gray-400"
                }`}
              >
                {change}
              </span>
            </div>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 backdrop-blur-sm border border-white/5">
            <Icon className="h-5 w-5 text-white/80" />
          </div>
        </div>
        <div
          className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r opacity-60"
          style={{ backgroundImage: `linear-gradient(to right, ${gradientFrom}, ${gradientTo})` }}
        ></div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [isHovering, setIsHovering] = useState<string | null>(null)
  const [selectedChain, setSelectedChain] = useState(chainOptions[0])
  const [showChainDropdown, setShowChainDropdown] = useState(false)
  const [dashboardStats, setDashboardStats] = useState<DashboardStats>({
    tokenHoldings: 0,
    totalTransactions: 0,
    activeChains: 1,
    totalTokens: 0,
  })
  const [tokenAssets, setTokenAssets] = useState<any[]>([])
  const [transactions, setTransactions] = useState<any[]>([])
  const [marketChart, setMarketChart] = useState<MarketData | null>(null)
  const [currentPrice, setCurrentPrice] = useState<string>("0")
  const [portfolioValue, setPortfolioValue] = useState<string>("0")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [loadingSteps, setLoadingSteps] = useState<LoadingStep[]>([
    { name: "Token Balances", status: "pending", message: "Preparing to fetch token balances..." },
    { name: "Transaction History", status: "pending", message: "Preparing to fetch transaction history..." },
    { name: "Portfolio Value", status: "pending", message: "Preparing to fetch portfolio value..." },
    { name: "Market Data", status: "pending", message: "Preparing to fetch market data..." },
    { name: "Current Price", status: "pending", message: "Preparing to fetch current SOL price..." },
  ])
  const [progress, setProgress] = useState(0)

  const rateLimitManager = new DashboardRateLimitManager()

  const updateLoadingStep :any= (
    stepName: string,
    status: "pending" | "loading" | "completed" | "error",
    message: string,
  ) => {
    setLoadingSteps((prev) => prev.map((step) => (step.name === stepName ? { ...step, status, message } : step)))

    // Update progress
    setLoadingSteps((current) => {
      const completed = current.filter((step) => step.status === "completed").length
      const total = current.length
      setProgress((completed / total) * 100)
      return current
    })
  }

  const formatCurrency = (value: string | number) => {
    try {
      const num = Number(value)
      if (isNaN(num) || num === 0) return "$0.00"
      if (num >= 1000000) {
        return `$${(num / 1000000).toFixed(2)}M`
      } else if (num >= 1000) {
        return `$${(num / 1000).toFixed(2)}K`
      }
      return `$${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    } catch (error) {
      console.warn("Error formatting currency:", value, error)
      return "$0.00"
    }
  }

  // Fetch all real data with rate limiting and error recovery
  const fetchAllData = async () => {
    setLoading(true)
    setError(null)
    setProgress(0)

    // Reset all steps to pending
    setLoadingSteps((prev) => prev.map((step) => ({ ...step, status: "pending" as const })))

    try {
      console.log("Starting sequential Solana data fetch with rate limiting...")

      // Add initial delay to prevent immediate API bombardment
      await new Promise((resolve) => setTimeout(resolve, 1000))

      let tokenBalancesRes, transactionHistoryRes, portfolioValueRes, marketDataRes, currentPriceRes

      try {
        tokenBalancesRes = await rateLimitManager.makeRequest(
          () => callMarketDataApi("total_token_balance"),
          "Token Balances",
          updateLoadingStep,
        )
      } catch (error) {
        console.warn("Token balances failed, using fallback:", error)
        tokenBalancesRes = { data: [{ tokenAssets: [] }] }
      }

      try {
        transactionHistoryRes = await rateLimitManager.makeRequest(
          () => callMarketDataApi("transaction_history"),
          "Transaction History",
          updateLoadingStep,
        )
      } catch (error) {
        console.warn("Transaction history failed, using fallback:", error)
        transactionHistoryRes = { data: [{ transactions: [], transactionList: [] }] }
      }

      try {
        portfolioValueRes = await rateLimitManager.makeRequest(
          () => callMarketDataApi("token_value"),
          "Portfolio Value",
          updateLoadingStep,
        )
      } catch (error) {
        console.warn("Portfolio value failed, using fallback:", error)
        portfolioValueRes = { data: [{ totalValue: "0" }] }
      }

      try {
        marketDataRes = await rateLimitManager.makeRequest(
          () => callMarketDataApi("hist_data"),
          "Market Data",
          updateLoadingStep,
        )
      } catch (error) {
        console.warn("Market data failed, using fallback:", error)
        marketDataRes = { data: [{ prices: [] }] }
      }

      try {
        currentPriceRes = await rateLimitManager.makeRequest(
          () => callMarketDataApi("price"),
          "Current Price",
          updateLoadingStep,
        )
      } catch (error) {
        console.warn("Current price failed, using fallback:", error)
        currentPriceRes = { data: [{ price: "0" }] }
      }

      console.log("All API calls completed, processing data...")

      // Initialize variables to hold processed data
      let processedTokens: any[] = []
      let processedTransactions: any[] = []
      let processedPortfolioValue = "0"
      let processedCurrentPrice = "0"

      // Process token balances with safe fallbacks
      try {
        const allTokenBalances = tokenBalancesRes?.data?.[0]?.tokenAssets || []
        console.log("Raw token balances:", allTokenBalances)
        processedTokens = Array.isArray(allTokenBalances) ? filterNonZeroTokens(allTokenBalances) : []
        console.log("Filtered tokens:", processedTokens.length, processedTokens)
      } catch (error) {
        console.warn("Error processing token balances:", error)
        processedTokens = []
      }

      // Process transactions with safe fallbacks
      try {
        const allTransactions =
          transactionHistoryRes?.data?.[0]?.transactions || transactionHistoryRes?.data?.[0]?.transactionList || []
        console.log("Raw transactions:", allTransactions)
        processedTransactions = Array.isArray(allTransactions) ? filterNonZeroTransactions(allTransactions) : []
        console.log("Filtered transactions:", processedTransactions.length, processedTransactions)
      } catch (error) {
        console.warn("Error processing transactions:", error)
        processedTransactions = []
      }

      // Process portfolio value with safe fallbacks
      try {
        const portfolioVal = portfolioValueRes?.data?.[0]?.totalValue || "0"
        console.log("Raw portfolio value:", portfolioVal)
        processedPortfolioValue = String(portfolioVal)

        // If portfolio value is 0 or invalid, calculate from token assets
        if (Number(processedPortfolioValue) === 0 && processedTokens.length > 0) {
          const calculatedValue = processedTokens.reduce((total, token) => {
            const balance = Number(token?.balance || 0)
            const price = Number(token?.tokenPrice || 0)
            return total + balance * price
          }, 0)
          processedPortfolioValue = String(calculatedValue)
          console.log("Calculated portfolio value from tokens:", processedPortfolioValue)
        }
      } catch (error) {
        console.warn("Error processing portfolio value:", error)
        processedPortfolioValue = "0"
      }

      // Process current price with safe fallbacks
      try {
        const price = currentPriceRes?.data?.[0]?.price || "0"
        console.log("Raw current price:", price)
        processedCurrentPrice = String(price)

        // If current price is 0, try to get it from token assets (SOL token)
        if (Number(processedCurrentPrice) === 0 && processedTokens.length > 0) {
          const solToken = processedTokens.find(
            (token) => token.symbol === "SOL" || token.tokenAddress === "So11111111111111111111111111111111111111112",
          )
          if (solToken && solToken.tokenPrice) {
            processedCurrentPrice = String(solToken.tokenPrice)
            console.log("Got SOL price from token assets:", processedCurrentPrice)
          }
        }
      } catch (error) {
        console.warn("Error processing current price:", error)
        processedCurrentPrice = "0"
      }

      // Process market chart data with safe fallbacks
      try {
        if (marketDataRes?.data?.[0]?.prices && Array.isArray(marketDataRes.data[0].prices)) {
          setMarketChart(marketDataRes)
        } else {
          setMarketChart(null)
        }
      } catch (error) {
        console.warn("Error processing market chart:", error)
        setMarketChart(null)
      }

      // Update all states together to prevent race conditions
      const newStats = {
        tokenHoldings: processedTokens.length,
        totalTransactions: processedTransactions.length,
        activeChains: 1,
        totalTokens: processedTokens.length,
      }

      console.log("Final processed data:", {
        tokens: processedTokens.length,
        transactions: processedTransactions.length,
        portfolioValue: processedPortfolioValue,
        currentPrice: processedCurrentPrice,
        stats: newStats,
      })

      // Update all states in the correct order
      setTokenAssets(processedTokens)
      setTransactions(processedTransactions)
      setPortfolioValue(processedPortfolioValue)
      setCurrentPrice(processedCurrentPrice)
      setDashboardStats(newStats)

      setLastUpdated(new Date())
      setLoading(false)
      console.log("Dashboard data processing completed successfully")
    } catch (error) {
      console.error("Critical error in fetchAllData:", error)
      setError("Failed to load dashboard data. Please check your connection and try refreshing.")
    } finally {
      setProgress(100)
    }
  }

  const handleRefresh = () => {
    fetchAllData()
  }

  // Fetch data on component mount with error boundary
  useEffect(() => {
    const initializeData = async () => {
      try {
        await fetchAllData()
      } catch (error) {
        console.error("Failed to initialize dashboard:", error)
        setError("Failed to initialize dashboard. Please refresh the page.")
        setLoading(false)
      }
    }

    initializeData()
  }, [])

  // Auto-refresh every 5 minutes with error handling
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        if (!loading) {
          await fetchAllData()
        }
      } catch (error) {
        console.error("Auto-refresh failed:", error)
      }
    }, 300000)

    return () => clearInterval(interval)
  }, [loading])

  // Debug logging
  useEffect(() => {
    console.log("Dashboard stats updated:", dashboardStats)
    console.log("Token assets length:", tokenAssets.length)
    console.log("Portfolio value:", portfolioValue)
    console.log("Current price:", currentPrice)
  }, [dashboardStats, tokenAssets.length, portfolioValue, currentPrice])

  return (
    <div className="space-y-10">
      {/* Loading Progress */}
      {loading && (
        <Card className="bg-black/40 border-white/20 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
                <span className="text-white font-medium">Loading Dashboard Data</span>
                <span className="text-white/60 text-sm">({Math.round(progress)}%)</span>
              </div>

              <div className="w-full bg-white/10 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-purple-500 to-blue-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {loadingSteps.map((step, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 rounded bg-white/5">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        step.status === "completed"
                          ? "bg-green-400"
                          : step.status === "loading"
                            ? "bg-yellow-400 animate-pulse"
                            : step.status === "error"
                              ? "bg-red-400"
                              : "bg-gray-400"
                      }`}
                    ></div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-medium">{step.name}</div>
                      <div className="text-white/60 text-xs truncate">{step.message}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Header Section */}
      <div className="relative">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-white to-white/80 text-transparent bg-clip-text mb-2">
              Welcome back
            </h1>
            <p className="text-white/60">Your Solana DeFi portfolio with real-time data</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative">
              <Button
                variant="outline"
                className="border-white/20 hover:bg-white/10 text-white gap-2"
                onClick={() => setShowChainDropdown(!showChainDropdown)}
                disabled={loading}
              >
                <div className="w-3 h-3 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 flex items-center justify-center text-white text-xs font-bold">
                  {selectedChain.label}
                </div>
                <ChevronDown className="h-4 w-4" />
              </Button>

              {showChainDropdown && (
                <div className="absolute top-full mt-2 right-0 bg-black/90 border border-white/20 rounded-lg p-2 min-w-[200px] z-50 backdrop-blur-sm">
                  <div className="max-h-60 overflow-y-auto">
                    {chainOptions.map((chain) => (
                      <button
                        key={chain.value}
                        className="w-full flex items-center justify-between p-2 hover:bg-white/10 rounded text-left text-white"
                        onClick={() => {
                          setSelectedChain(chain)
                          setShowChainDropdown(false)
                        }}
                      >
                        <span>{chain.name}</span>
                        {selectedChain.value === chain.value && (
                          <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Button
              variant="outline"
              size="icon"
              className="border-white/20 hover:bg-white/10 text-white"
              onClick={handleRefresh}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <DashboardCard
            id="total-holdings"
            title="Total Holdings"
            value={
              loading
                ? "Loading..."
                : Number(portfolioValue) > 0
                  ? formatCurrency(portfolioValue)
                  : dashboardStats.tokenHoldings > 0
                    ? "Calculating..."
                    : "$0.00"
            }
            change={`${dashboardStats.totalTokens} active tokens`}
            trend="up"
            icon={Coins}
            gradientFrom="#8B5CF6"
            gradientTo="#3B82F6"
            loading={loading}
          />
          <DashboardCard
            id="sol-price"
            title="SOL Price"
            value={loading ? "Loading..." : Number(currentPrice) > 0 ? `$${Number(currentPrice).toFixed(2)}` : "$0.00"}
            change="Real-time price"
            trend="up"
            icon={TrendingUp}
            gradientFrom="#EC4899"
            gradientTo="#8B5CF6"
            loading={loading}
          />
          <DashboardCard
            id="transactions"
            title="Transactions"
            value={loading ? "Loading..." : dashboardStats.totalTransactions.toString()}
            change="Non-zero transactions"
            trend="up"
            icon={CreditCard}
            gradientFrom="#F59E0B"
            gradientTo="#EF4444"
            loading={loading}
          />
          <DashboardCard
            id="updated"
            title="Last Updated"
            value={lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            change="Auto-refresh: 5min"
            trend="up"
            icon={RefreshCw}
            gradientFrom="#10B981"
            gradientTo="#3B82F6"
            loading={loading}
          />
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <Card className="bg-red-900/20 border-red-500/30">
          <CardContent className="p-4">
            <div className="text-red-400 text-sm">
              <strong>Error:</strong> {error}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Market Chart Section */}
      {marketChart && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <SolanaMarketChart data={marketChart} title="SOL Price History" />
          </div>
          <div>
            <Card className="bg-black/20 border-white/10 hover:border-white/20 transition-all hover:shadow-xl h-full">
              <CardHeader>
                <CardTitle className="text-xl font-bold bg-gradient-to-r from-white to-white/80 text-transparent bg-clip-text">
                  Market Stats
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-white/60">Current SOL Price</span>
                  <span className="text-white font-bold">
                    {loading
                      ? "Loading..."
                      : Number(currentPrice) > 0
                        ? `$${Number(currentPrice).toFixed(2)}`
                        : "$0.00"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-white/60">Portfolio Value</span>
                  <span className="text-white font-bold">
                    {loading ? "Loading..." : Number(portfolioValue) > 0 ? formatCurrency(portfolioValue) : "$0.00"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-white/60">Active Tokens</span>
                  <span className="text-white font-bold">{loading ? "Loading..." : dashboardStats.totalTokens}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-white/60">Transactions</span>
                  <span className="text-white font-bold">
                    {loading ? "Loading..." : dashboardStats.totalTransactions}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-white/60">Address</span>
                  <span className="text-white font-mono text-xs">{SOLANA_ADDRESS.slice(0, 8)}...</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-10">
        {/* Recent Transactions */}
        <div className="col-span-2">
          <Card className="bg-black/20 border-white/10 hover:border-white/20 transition-all hover:shadow-xl h-full">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="text-xl font-bold bg-gradient-to-r from-white to-white/80 text-transparent bg-clip-text">
                  Recent Transactions ({transactions.length})
                </CardTitle>
                <Link href="/dashboard/portfolio">
                  <Button variant="ghost" size="sm" className="gap-1 text-white/80 hover:text-white hover:bg-white/10">
                    View All <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {loading ? (
                  <div className="text-white/60 text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                    Loading transactions...
                  </div>
                ) : transactions.length === 0 ? (
                  <div className="text-white/60 text-center py-8">No non-zero transactions found.</div>
                ) : (
                  transactions.slice(0, 5).map((tx, idx) => (
                    <div
                      key={idx}
                      className="flex justify-between items-center p-4 hover:bg-white/5 rounded-lg transition-colors border border-transparent hover:border-white/5"
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className={`p-2.5 rounded-full ${
                            tx.amount && Number(tx.amount) > 0
                              ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-500 border border-rose-500/20"
                          }`}
                        >
                          {tx.amount && Number(tx.amount) > 0 ? "+" : "-"}
                        </div>
                        <div>
                          <p className="font-medium text-white/90">{tx.symbol || "SOL"}</p>
                          <p className="text-sm text-white/60">
                            {tx.txTime ? new Date(Number(tx.txTime) * 1000).toLocaleString() : "Recent"}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-white/90">{Number(tx.amount || 0).toFixed(6)}</p>
                        <p className="text-sm text-white/60">
                          {tx.txHash ? `${tx.txHash.slice(0, 8)}...${tx.txHash.slice(-6)}` : "Transaction"}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div>
          <Card className="bg-black/20 border-white/10 hover:border-white/20 transition-all hover:shadow-xl h-full">
            <CardHeader>
              <CardTitle className="text-xl font-bold bg-gradient-to-r from-white to-white/80 text-transparent bg-clip-text">
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 mb-6">
                {quickActions.map((action) => (
                  <Link
                    href={action.href}
                    key={action.id}
                    onMouseEnter={() => setIsHovering(action.id)}
                    onMouseLeave={() => setIsHovering(null)}
                  >
                    <div className="relative group flex flex-col items-center justify-center p-5 rounded-xl overflow-hidden transition-all hover:scale-105 duration-300">
                      <div
                        className={`absolute inset-0 bg-gradient-to-br opacity-20 ${isHovering === action.id ? "opacity-40" : "opacity-20"} transition-opacity`}
                        style={{
                          backgroundImage: `linear-gradient(to bottom right, ${action.gradientFrom}, ${action.gradientTo})`,
                        }}
                      ></div>
                      <div className="relative z-10 flex flex-col items-center">
                        <action.icon className={`h-8 w-8 mb-3 text-white group-hover:scale-110 transition-transform`} />
                        <span className="font-medium text-white text-sm">{action.label}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>

              <div className="p-4 rounded-lg bg-gradient-to-r from-violet-500/20 to-blue-500/20 border border-white/10">
                <div className="flex items-center mb-2">
                  <Sparkles className="h-5 w-5 mr-2 text-purple-400" />
                  <h3 className="font-medium text-white">Portfolio Summary</h3>
                </div>
                <p className="text-sm text-white/70 mb-3">
                  {loading
                    ? "Loading portfolio data..."
                    : `${dashboardStats.tokenHoldings} active tokens worth ${formatCurrency(portfolioValue)}. SOL price: ${Number(currentPrice) > 0 ? `$${Number(currentPrice).toFixed(2)}` : "Loading..."}`}
                </p>
                <Link href="/dashboard/ai-chat">
                  <Button size="sm" variant="outline" className="w-full border-white/20 hover:bg-white/10 text-white">
                    Get AI Analysis
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Token Holdings */}
      <Card className="bg-black/20 border-white/10 hover:border-white/20 transition-all hover:shadow-xl">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-xl font-bold bg-gradient-to-r from-white to-white/80 text-transparent bg-clip-text">
              Active Token Holdings ({tokenAssets.length})
            </CardTitle>
            <div className="flex space-x-2">
              <Button variant="outline" size="sm" className="border-white/20 hover:bg-white/10 text-white">
                Value
              </Button>
              <Button variant="outline" size="sm" className="border-white/20 bg-white/10 text-white">
                Balance
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            {loading ? (
              <div className="text-white/60 text-center py-8">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                Loading token balances...
              </div>
            ) : tokenAssets.length === 0 ? (
              <div className="text-white/60 text-center py-8">No active token holdings found.</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left pb-3 text-white/60">Token</th>
                    <th className="text-right pb-3 text-white/60">Balance</th>
                    <th className="text-right pb-3 text-white/60">Price</th>
                    <th className="text-right pb-3 text-white/60">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {tokenAssets.slice(0, 10).map((asset, idx) => {
                    const balance = Number(asset.balance || 0)
                    const price = Number(asset.tokenPrice || 0)
                    const value = balance * price

                    return (
                      <tr key={idx} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 flex items-center justify-center text-white text-xs font-bold">
                              {asset.symbol?.slice(0, 2) || "TK"}
                            </div>
                            <span className="font-medium text-white">{asset.symbol || "Unknown"}</span>
                          </div>
                        </td>
                        <td className="text-right py-4 text-white">
                          {balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                        </td>
                        <td className="text-right py-4 text-white">
                          ${price.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </td>
                        <td className="text-right py-4 text-white font-medium">
                          ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
