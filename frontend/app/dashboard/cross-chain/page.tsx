"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { useWallet } from "@/contexts/WalletContext"
import { useWalletAddress } from "@/components/wallet/WalletProtection"
import {
  Info,
  ChevronDown,
  Check,
  Copy,
  ArrowRightLeft,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Link,
  Shield,
  Sparkles,
  Clock,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// Interfaces for API responses
interface Token {
  symbol: string
  name: string
  address: string
  decimals: number
  logoUrl?: string
  chainIndex: string
  chainId: string
  hasLogo?: boolean
}

interface TokenPair {
  fromChainIndex: string
  toChainIndex: string
  fromChainId: string
  toChainId: string
  fromTokenAddress: string
  toTokenAddress: string
  fromTokenSymbol: string
  toTokenSymbol: string
  pairId: string
}

interface Bridge {
  bridgeId: number
  bridgeName: string
  requireOtherNativeFee: boolean
  logoUrl?: string
  supportedChains: string[]
  supportsSolana: boolean
}

interface CrossChainSwapResult {
  success: boolean
  action: string
  timestamp: string
  fromChain: string
  toChain: string
  code: string
  data: Array<{
    fromTokenAmount: string
    toTokenAmount: string
    minmumReceive: string
    router: {
      bridgeId: number
      bridgeName: string
      otherNativeFee: string
      crossChainFee: string
      crossChainFeeTokenAddress: string
    }
    tx: {
      data: string
      from: string
      to: string
      value: string
      gasLimit: string
      gasPrice: string
      maxPriorityFeePerGas?: string
    }
  }>
  msg: string
}

interface LoadingState {
  bridges: boolean
  pairs: boolean
  fromTokens: boolean
  toTokens: boolean
  currentStep: string
  progress: number
  totalSteps: number
  currentStepIndex: number
}

interface RequestQueue {
  url: string
  name: string
  delay: number
  retries: number
}

const chainList = [
  { name: "Solana", index: "501", id: "501", color: "from-purple-500 to-blue-500" },
  { name: "Ethereum", index: "1", id: "1", color: "from-blue-600 to-purple-600" },
  { name: "BNB Chain", index: "56", id: "56", color: "from-yellow-500 to-orange-500" },
  { name: "Polygon", index: "137", id: "137", color: "from-purple-600 to-pink-500" },
  { name: "Arbitrum", index: "42161", id: "42161", color: "from-blue-600 to-cyan-500" },
  { name: "Optimism", index: "10", id: "10", color: "from-red-500 to-pink-500" },
  { name: "Avalanche", index: "43114", id: "43114", color: "from-red-600 to-orange-500" },
  { name: "Fantom", index: "250", id: "250", color: "from-blue-400 to-cyan-400" },
]

const routeOptions = [
  { value: "1", label: "Optimal Route", description: "Best balance of cost and speed" },
  { value: "0", label: "Most Tokens", description: "Maximum tokens received" },
  { value: "2", label: "Fastest Route", description: "Quickest execution time" },
]

// Enhanced rate limiting with exponential backoff
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Request queue manager
class RequestQueueManager {
  private queue: RequestQueue[] = []
  private isProcessing = false
  private lastRequestTime = 0
  private minDelay = 5000 // 5 seconds minimum between requests
  private maxRetries = 3

  async addRequest(url: string, name: string, initialDelay = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        url,
        name,
        delay: initialDelay,
        retries: 0,
      })

      this.processQueue().then(resolve).catch(reject)
    })
  }

  private async processQueue(): Promise<any> {
    if (this.isProcessing || this.queue.length === 0) {
      return
    }

    this.isProcessing = true

    while (this.queue.length > 0) {
      const request = this.queue.shift()!

      try {
        // Calculate delay since last request
        const timeSinceLastRequest = Date.now() - this.lastRequestTime
        const requiredDelay = Math.max(this.minDelay - timeSinceLastRequest, 0)

        if (requiredDelay > 0) {
          console.log(`⏳ Waiting ${requiredDelay}ms before ${request.name}...`)
          await delay(requiredDelay)
        }

        console.log(`🚀 Making request: ${request.name}`)
        this.lastRequestTime = Date.now()

        const response = await fetch(request.url)

        if (!response.ok) {
          if (response.status === 429) {
            // Rate limited - exponential backoff
            request.retries++
            if (request.retries <= this.maxRetries) {
              const backoffDelay = Math.min(request.delay * Math.pow(2, request.retries), 30000) // Max 30s
              console.log(
                `⚠️ Rate limited. Retrying ${request.name} in ${backoffDelay}ms (attempt ${request.retries}/${this.maxRetries})`,
              )

              // Add back to front of queue with increased delay
              this.queue.unshift({
                ...request,
                delay: backoffDelay,
              })

              await delay(backoffDelay)
              continue
            } else {
              throw new Error(`Rate limit exceeded for ${request.name} after ${this.maxRetries} retries`)
            }
          } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
        }

        const data = await response.json()
        this.isProcessing = false
        return data
      } catch (error:any) {
        console.error(`❌ Error with ${request.name}:`, error)

        // Retry logic for non-rate-limit errors
        if (request.retries < this.maxRetries && !error.message.includes("Rate limit exceeded")) {
          request.retries++
          const retryDelay = 3000 * request.retries // 3s, 6s, 9s
          console.log(`🔄 Retrying ${request.name} in ${retryDelay}ms (attempt ${request.retries}/${this.maxRetries})`)

          this.queue.unshift({
            ...request,
            delay: retryDelay,
          })

          await delay(retryDelay)
          continue
        }

        this.isProcessing = false
        throw error
      }
    }

    this.isProcessing = false
  }
}

export default function  CrossChainSwapPage(){
  const { publicKey } = useWallet()
  const walletAddress = useWalletAddress()
  
  // Chain and token state
  const [fromChain, setFromChain] = useState(chainList[0]) // Solana
  const [toChain, setToChain] = useState(chainList[1]) // Ethereum
  const [fromTokens, setFromTokens] = useState<Token[]>([])
  const [toTokens, setToTokens] = useState<Token[]>([])
  const [fromToken, setFromToken] = useState<Token | null>(null)
  const [toToken, setToToken] = useState<Token | null>(null)

  // API data state
  const [supportedPairs, setSupportedPairs] = useState<TokenPair[]>([])
  const [supportedBridges, setSupportedBridges] = useState<Bridge[]>([])
  const [loadingState, setLoadingState] = useState<LoadingState>({
    bridges: false,
    pairs: false,
    fromTokens: false,
    toTokens: false,
    currentStep: "",
    progress: 0,
    totalSteps: 4,
    currentStepIndex: 0,
  })

  // Swap state
  const [fromAmount, setFromAmount] = useState("0.1")
  const [toAmount, setToAmount] = useState("")
  const [slippage, setSlippage] = useState("0.01")
  const [routeSort, setRouteSort] = useState("1")
  const [feePercent, setFeePercent] = useState("0.1")
  const [swapResult, setSwapResult] = useState<CrossChainSwapResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // UI state
  const [showFromChains, setShowFromChains] = useState(false)
  const [showToChains, setShowToChains] = useState(false)
  const [showFromTokens, setShowFromTokens] = useState(false)
  const [showToTokens, setShowToTokens] = useState(false)
  const [showRouteOptions, setShowRouteOptions] = useState(false)
  const [showSupportedPairs, setShowSupportedPairs] = useState(false)

  // Rate limiting state
  const [rateLimitInfo, setRateLimitInfo] = useState({
    isRateLimited: false,
    nextRequestTime: 0,
    requestCount: 0,
  })

  // Request queue manager
  const requestQueueRef = useRef(new RequestQueueManager())

  // Validation state
  const [pairValidation, setPairValidation] = useState<{
    isValid: boolean
    message: string
    availableBridges: Bridge[]
  }>({
    isValid: false,
    message: "",
    availableBridges: [],
  })

  // Token balance state
  const [tokenBalances, setTokenBalances] = useState<Record<string, { balance: string; price: string }>>({})
  const [loadingBalances, setLoadingBalances] = useState(false)
  const [balanceError, setBalanceError] = useState<string | null>(null)

  // Recipient address state for manual input
  const [recipientAddress, setRecipientAddress] = useState("")

  // Use real wallet addresses for sending only
  const solanaWallet = walletAddress || publicKey || ""

  const getCurrentWallet = (chain: (typeof chainList)[0]) => {
    // Only return wallet address for sending (fromChain)
    return chain.index === "501" ? solanaWallet : solanaWallet // Use connected wallet for both
  }

  // Get recipient address (always require manual input)
  const getRecipientAddress = () => {
    return recipientAddress.trim()
  }

  // Function to validate recipient address format
  const validateRecipientAddress = (address: string, chain: (typeof chainList)[0]): boolean => {
    if (!address.trim()) return false
    
    if (chain.index === "501") {
      // Solana address validation (base58, 32-44 characters)
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
    } else {
      // EVM address validation (starts with 0x, 42 characters total)
      return /^0x[a-fA-F0-9]{40}$/.test(address)
    }
  }

  // Function to fetch real wallet balances for Solana
  const fetchTokenBalances = async () => {
    if (!walletAddress && !publicKey) {
      console.log("No wallet connected, using demo balances")
      return
    }

    setLoadingBalances(true)
    setBalanceError(null)

    try {
      const userWalletAddress = walletAddress || publicKey
      console.log("Fetching token balances for:", userWalletAddress)

      const response = await fetch("/api/portfolio/total_token_balances", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: userWalletAddress,
          chains: "501",
          excludeRiskToken: "0",
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch balances: ${response.status}`)
      }

      const data = await response.json()
      console.log("Balance response:", data)

      if (data.success && data.data && data.data[0]?.tokenAssets) {
        const balances: Record<string, { balance: string; price: string }> = {}
        
        data.data[0].tokenAssets.forEach((token: any) => {
          const balance = token.balance || "0"
          const price = token.tokenPrice || "0"
          
          // Map token addresses to balances
          balances[token.tokenContractAddress] = {
            balance: balance,
            price: price,
          }
          
          // Also map by symbol for easier lookup
          if (token.symbol) {
            balances[token.symbol] = {
              balance: balance,
              price: price,
            }
          }
        })

        setTokenBalances(balances)
        console.log("Updated token balances:", balances)
      } else {
        throw new Error("Invalid balance data received")
      }
    } catch (error: any) {
      console.error("Error fetching token balances:", error)
      setBalanceError(error.message)
    } finally {
      setLoadingBalances(false)
    }
  }

  // Function to get balance for a specific token (only show balances for sending wallet)
  const getTokenBalance = (token: Token | null, chain: (typeof chainList)[0], isFromToken: boolean = true): { balance: string; price: string; usdValue: string } => {
    if (!token) {
      return { balance: "0.00", price: "0.00", usdValue: "0.00" }
    }

    // Only show balance for sending tokens (fromToken), not receiving tokens
    if (!isFromToken) {
      return { balance: "—", price: "—", usdValue: "—" }
    }

    // Only use real balances for Solana tokens when wallet is connected
    if (chain.index === "501" && (walletAddress || publicKey)) {
      const balanceData = tokenBalances[token.address] || tokenBalances[token.symbol] || { balance: "0", price: "0" }
      const balance = Number(balanceData.balance) / Math.pow(10, token.decimals)
      const price = Number(balanceData.price)
      const usdValue = (balance * price).toFixed(2)

      return {
        balance: balance.toFixed(6),
        price: price.toFixed(2),
        usdValue: usdValue,
      }
    }

    // Demo balances only for sending tokens and only for Solana
    if (chain.index === "501") {
      const demoBalances: Record<string, string> = {
        SOL: "12.45",
        USDC: "350.21",
        USDT: "125.50",
      }
      const demoBalance = demoBalances[token.symbol] || "0.00"
      const demoPrice = token.symbol === "SOL" ? "97.35" : "1.00"
      const usdValue = (Number(demoBalance) * Number(demoPrice)).toFixed(2)
      
      return {
        balance: demoBalance,
        price: demoPrice,
        usdValue: usdValue,
      }
    }

    // No balance shown for non-Solana chains
    return { balance: "—", price: "—", usdValue: "—" }
  }

  // Function to set max amount for from token
  const setMaxAmount = () => {
    const tokenBalance = getTokenBalance(fromToken, fromChain, true)
    const maxBalance = tokenBalance.balance
    
    // Skip if balance is not available
    if (maxBalance === "—" || maxBalance === "0.00") {
      return
    }
    
    // For native tokens, reserve amount for transaction fees
    let adjustedMax = Number(maxBalance)
    if (fromToken?.symbol === "SOL" && adjustedMax > 0.01) {
      adjustedMax = adjustedMax - 0.01 // Reserve 0.01 SOL for fees
    } else if (fromToken?.symbol === "ETH" && adjustedMax > 0.005) {
      adjustedMax = adjustedMax - 0.005 // Reserve 0.005 ETH for fees
    }
    
    setFromAmount(Math.max(0, adjustedMax).toFixed(6))
    setSwapResult(null)
    setToAmount("")
  }

  // Update loading progress
  const updateLoadingProgress = (stepIndex: number, stepName: string) => {
    const progress = Math.round((stepIndex / loadingState.totalSteps) * 100)
    setLoadingState((prev) => ({
      ...prev,
      currentStep: stepName,
      progress,
      currentStepIndex: stepIndex,
    }))
  }

  // Enhanced API fetching with queue management
  const fetchWithQueue = async (url: string, stepName: string, stepIndex: number) => {
    updateLoadingProgress(stepIndex, `${stepName}...`)

    try {
      const data = await requestQueueRef.current.addRequest(url, stepName)

      if (data.success && (data.bridges || data.pairs || data.tokens)) {
        console.log(`✅ Successfully loaded ${stepName}`)
        setRateLimitInfo((prev) => ({ ...prev, requestCount: prev.requestCount + 1 }))
        return data
      } else {
        throw new Error(data.error || `Failed to fetch ${stepName}`)
      }
    } catch (error: any) {
      console.error(`❌ Error fetching ${stepName}:`, error)

      if (error.message.includes("429") || error.message.includes("Rate limit")) {
        setRateLimitInfo((prev) => ({
          ...prev,
          isRateLimited: true,
          nextRequestTime: Date.now() + 30000, // 30 seconds
        }))
      }

      throw error
    }
  }

  // Fetch supported bridges
  const fetchSupportedBridges = async () => {
    try {
      setLoadingState((prev) => ({ ...prev, bridges: true }))

      const data = await fetchWithQueue("/api/cross-chain-bridges", "Loading bridges", 1)

      if (data.bridges) {
        setSupportedBridges(data.bridges)
        console.log(`📊 Loaded ${data.bridges.length} supported bridges`)
        return data.bridges
      }
      return []
    } catch (error) {
      console.error("Error fetching supported bridges:", error)
      return []
    } finally {
      setLoadingState((prev) => ({ ...prev, bridges: false }))
    }
  }

  // Fetch supported token pairs
  const fetchSupportedPairs = async () => {
    try {
      setLoadingState((prev) => ({ ...prev, pairs: true }))

      const data = await fetchWithQueue("/api/cross-chain-pairs", "Loading token pairs", 2)
      console.log("My data loaded with pairs are:::::",data);
      
      if (data.pairs) {
        setSupportedPairs(data.pairs)
        console.log(`🔗 Loaded ${data.pairs.length} supported token pairs`)
        return data.pairs
      }
      return []
    } catch (error) {
      console.error("Error fetching supported pairs:", error)
      return []
    } finally {
      setLoadingState((prev) => ({ ...prev, pairs: false }))
    }
  }

  // Fetch tokens for a specific chain
  const fetchTokensForChain = async (chainIndex: string, chainName: string, stepIndex: number) => {
    try {
      const stepName = `Loading ${chainName} tokens`
      const data = await fetchWithQueue(
        `/api/cross-chain-tokens?chainIndex=${chainIndex}&type=chain-tokens`,
        stepName,
        stepIndex,
      )

      if (data.tokens) {
        console.log(`🪙 Loaded ${data.tokens.length} tokens for ${chainName}`)
        return data.tokens
      }
      return []
    } catch (error) {
      console.error(`Error fetching tokens for ${chainName}:`, error)
      return []
    }
  }

  // Load tokens for both chains sequentially
  const loadTokensForChains = async () => {
    try {
      setLoadingState((prev) => ({ ...prev, fromTokens: true }))

      // Load from chain tokens
      const fromTokensData = await fetchTokensForChain(fromChain.index, fromChain.name, 3)
      setFromTokens(fromTokensData)

      // Set default from token
      if (fromTokensData.length > 0 && !fromToken) {
        const defaultFromToken = fromTokensData.find((t: Token) => t.symbol === "SOL") || fromTokensData[0]
        setFromToken(defaultFromToken)
      }

      setLoadingState((prev) => ({ ...prev, fromTokens: false, toTokens: true }))

      // Load to chain tokens
      const toTokensData = await fetchTokensForChain(toChain.index, toChain.name, 4)
      setToTokens(toTokensData)

      // Set default to token
      if (toTokensData.length > 0 && !toToken) {
        const defaultToToken = toTokensData.find((t: Token) => t.symbol === "USDC") || toTokensData[0]
        setToToken(defaultToToken)
      }

      updateLoadingProgress(4, "✅ All data loaded successfully!")

      // Clear loading state after success
      setTimeout(() => {
        setLoadingState((prev) => ({
          ...prev,
          currentStep: "",
          progress: 0,
          currentStepIndex: 0,
          toTokens: false,
        }))
      }, 2000)
    } catch (error:any) {
      console.error("Error loading tokens:", error)
      setError(`Failed to load tokens: ${error.message}`)
    } finally {
      setLoadingState((prev) => ({ ...prev, fromTokens: false, toTokens: false }))
    }
  }

  // Sequential data loading with enhanced error handling
  const loadAllData = async () => {
    try {
      setError(null)
      setRateLimitInfo({ isRateLimited: false, nextRequestTime: 0, requestCount: 0 })

      setLoadingState({
        bridges: false,
        pairs: false,
        fromTokens: false,
        toTokens: false,
        currentStep: "🚀 Starting data load...",
        progress: 0,
        totalSteps: 4,
        currentStepIndex: 0,
      })

      console.log("🔄 Starting sequential API loading...")

      // Step 1: Load bridges (5s delay)
      await fetchSupportedBridges()

      // Step 2: Load pairs (5s delay)
      await fetchSupportedPairs()

      // Step 3 & 4: Load tokens for both chains (5s delay each)
      await loadTokensForChains()

      console.log("🎉 All data loaded successfully!")
    } catch (error: any) {
      console.error("❌ Error loading data:", error)
      setError(`Failed to load data: ${error.message}`)

      setLoadingState((prev) => ({
        ...prev,
        currentStep: "❌ Error occurred",
        progress: 0,
        bridges: false,
        pairs: false,
        fromTokens: false,
        toTokens: false,
      }))
    }
  }

  // Validate token pair
  const validateTokenPair = () => {
    if (!fromToken || !toToken || !fromChain || !toChain) {
      setPairValidation({
        isValid: false,
        message: "Please select both tokens",
        availableBridges: [],
      })
      return
    }

    // Check if the pair is supported
    const supportedPair = supportedPairs.find(
      (pair) =>
        pair.fromChainIndex === fromChain.index &&
        pair.toChainIndex === toChain.index &&
        pair.fromTokenSymbol === fromToken.symbol &&
        pair.toTokenSymbol === toToken.symbol,
    )

    if (supportedPair) {
      // Find bridges that support this chain combination
      const availableBridges = supportedBridges.filter(
        (bridge) => bridge.supportedChains.includes(fromChain.index) && bridge.supportedChains.includes(toChain.index),
      )

      setPairValidation({
        isValid: true,
        message: `✅ Supported pair with ${availableBridges.length} available bridge(s)`,
        availableBridges,
      })
    } else {
      // Check if there are any pairs for this chain combination
      const chainPairs = supportedPairs.filter(
        (pair) => pair.fromChainIndex === fromChain.index && pair.toChainIndex === toChain.index,
      )

      if (chainPairs.length > 0) {
        const availableTokens = chainPairs.map((p) => `${p.fromTokenSymbol} → ${p.toTokenSymbol}`).join(", ")
        setPairValidation({
          isValid: false,
          message: `⚠️ This token pair is not supported. Available pairs: ${availableTokens}`,
          availableBridges: [],
        })
      } else {
        setPairValidation({
          isValid: false,
          message: `❌ No supported pairs between ${fromChain.name} and ${toChain.name}`,
          availableBridges: [],
        })
      }
    }
  }

  // Load initial data with delay
  useEffect(() => {
    // Add initial delay to prevent immediate API calls
    const timer = setTimeout(() => {
      loadAllData()
    }, 1000)

    return () => clearTimeout(timer)
  }, [])

  // Load tokens when chains change (with debouncing)
  useEffect(() => {
    if (supportedPairs.length > 0) {
      const timer = setTimeout(() => {
        loadTokensForChains()
      }, 500)

      return () => clearTimeout(timer)
    }
  }, [fromChain, toChain])

  // Validate pair when tokens or chains change
  useEffect(() => {
    validateTokenPair()
  }, [fromToken, toToken, fromChain, toChain, supportedPairs, supportedBridges])

  // Fetch balances when wallet connects or tokens change
  useEffect(() => {
    if ((walletAddress || publicKey) && fromChain.index === "501") {
      fetchTokenBalances()
    }
  }, [walletAddress, publicKey, fromToken, toToken])

  const handleSwapChains = () => {
    const tempChain = fromChain
    const tempToken = fromToken
    setFromChain(toChain)
    setToChain(tempChain)
    setFromToken(toToken)
    setToToken(tempToken)
    setFromAmount(toAmount)
    setToAmount(fromAmount)
    setSwapResult(null)
  }

  const formatAmount = (amount: string, decimals: number): string => {
    const num = Number.parseFloat(amount || "0")
    return Math.floor(num * Math.pow(10, decimals)).toString()
  }

  const formatDisplayAmount = (amount: string, decimals: number): string => {
    const num = Number.parseFloat(amount || "0")
    return (num / Math.pow(10, decimals)).toFixed(6)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const handleBuildTransaction = async () => {
    if (!fromAmount || Number.parseFloat(fromAmount) <= 0) {
      setError("Please enter a valid amount")
      return
    }

    if (!fromToken || !toToken) {
      setError("Please select both tokens")
      return
    }

    // Validate recipient address (always required)
    if (!recipientAddress.trim()) {
      setError("Please enter a recipient address")
      return
    }
    if (!validateRecipientAddress(recipientAddress, toChain)) {
      setError(`Invalid recipient address format for ${toChain.name}`)
      return
    }

    // Validate that at least one chain is Solana
    if (fromChain.index !== "501" && toChain.index !== "501") {
      setError("At least one chain must be Solana for cross-chain swaps")
      return
    }

    // Check if pair is valid
    if (!pairValidation.isValid) {
      setError(`Invalid token pair: ${pairValidation.message}`)
      return
    }

    setLoading(true)
    setError(null)
    setSwapResult(null)

    try {
      const formattedAmount = formatAmount(fromAmount, fromToken.decimals)

      const params = {
        action: "build-tx",
        fromChainIndex: fromChain.index,
        toChainIndex: toChain.index,
        fromChainId: fromChain.id,
        toChainId: toChain.id,
        fromTokenAddress: fromToken.address,
        toTokenAddress: toToken.address,
        amount: formattedAmount,
        slippage: slippage,
        userWalletAddress: getCurrentWallet(fromChain),
        receiveAddress: getRecipientAddress(),
        sort: routeSort,
        feePercent: feePercent,
        priceImpactProtectionPercentage: "0.25", // 25% max price impact
      }

      console.log("Cross-chain swap params:", params)

      const res = await fetch("/api/cross-chain-swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      })

      const data = await res.json()
      console.log("Cross-chain swap response:", data)

      if (data.error) {
        setError(data.error)
      } else if (data.success && data.data && data.data.length > 0) {
        setSwapResult(data)
        // Update estimated receive amount
        const estimatedAmount = formatDisplayAmount(data.data[0].toTokenAmount, toToken.decimals)
        setToAmount(estimatedAmount)
      } else {
        setError(data.msg || "Failed to build cross-chain transaction")
      }
    } catch (e: any) {
      setError(e.message || "Network error occurred")
    } finally {
      setLoading(false)
    }
  }

  const handleRefreshData = async () => {
    // Prevent refresh if currently loading or rate limited
    if (isLoading || rateLimitInfo.isRateLimited) {
      return
    }

    await loadAllData()
  }

  // Get supported pairs for current chain combination
  const getCurrentChainPairs = () => {
    return supportedPairs.filter(
      (pair) => pair.fromChainIndex === fromChain.index && pair.toChainIndex === toChain.index,
    )
  }

  // Get all unique chain combinations
  const getChainCombinations = () => {
    const combinations = new Map()
    supportedPairs.forEach((pair) => {
      const key = `${pair.fromChainIndex}-${pair.toChainIndex}`
      if (!combinations.has(key)) {
        const fromChainInfo = chainList.find((c) => c.index === pair.fromChainIndex)
        const toChainInfo = chainList.find((c) => c.index === pair.toChainIndex)
        if (fromChainInfo && toChainInfo) {
          combinations.set(key, {
            from: fromChainInfo,
            to: toChainInfo,
            pairs: [],
          })
        }
      }
      combinations.get(key)?.pairs.push(pair)
    })
    return Array.from(combinations.values())
  }

  const isLoading = loadingState.bridges || loadingState.pairs || loadingState.fromTokens || loadingState.toTokens

  // Rate limit countdown
  const getRateLimitCountdown = () => {
    if (!rateLimitInfo.isRateLimited) return 0
    return Math.max(0, Math.ceil((rateLimitInfo.nextRequestTime - Date.now()) / 1000))
  }

  const ChainSelector = ({
    chains,
    selectedChain,
    onSelect,
    show,
    onToggle,
    dropDirection = "down",
  }: {
    chains: typeof chainList
    selectedChain: (typeof chainList)[0]
    onSelect: (chain: (typeof chainList)[0]) => void
    show: boolean
    onToggle: () => void
    dropDirection?: "up" | "down"
  }) => (
    <div className="relative">
      <Button
        className="bg-card/50 hover:bg-muted text-foreground gap-2 font-medium border-border h-9 relative z-20"
        variant="outline"
        onClick={onToggle}
      >
        <div
          className={`w-5 h-5 rounded-full bg-gradient-to-r ${selectedChain.color} flex items-center justify-center text-background text-xs font-bold`}
        >
          {selectedChain.name.slice(0, 2)}
        </div>
        {selectedChain.name}
        <ChevronDown className={`h-4 w-4 transition-transform ${dropDirection === "up" ? "rotate-180" : ""}`} />
      </Button>

      {show && (
        <div 
          className={`absolute ${
            dropDirection === "up" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]"
          } right-0 bg-card border border-border rounded-lg p-2 min-w-[200px] z-[100] backdrop-blur-sm max-h-[240px] overflow-y-auto shadow-lg`}
          style={{ 
            position: 'absolute',
            [dropDirection === "up" ? "bottom" : "top"]: "100%",
            right: 0,
            marginTop: dropDirection === "down" ? "8px" : undefined,
            marginBottom: dropDirection === "up" ? "8px" : undefined
          }}
        >
          <div className="space-y-1">
            {chains.map((chain) => (
              <button
                key={chain.id}
                className="w-full flex items-center gap-3 p-2 hover:bg-muted/50 rounded text-left text-foreground transition-colors"
                onClick={() => {
                  onSelect(chain)
                  onToggle()
                }}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-gradient-to-r ${chain.color} flex items-center justify-center text-background text-xs font-bold`}
                >
                  {chain.name.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{chain.name}</div>
                  <div className="text-xs text-muted-foreground">Chain ID: {chain.id}</div>
                </div>
                {selectedChain.id === chain.id && <Check className="h-4 w-4 text-emerald-500 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  const TokenSelector = ({
    tokens,
    selectedToken,
    onSelect,
    show,
    onToggle,
    loading,
    dropDirection = "down",
  }: {
    tokens: Token[]
    selectedToken: Token | null
    onSelect: (token: Token) => void
    show: boolean
    onToggle: () => void
    loading: boolean
    dropDirection?: "up" | "down"
  }) => (
    <div className="relative isolate">
      <Button
        className="bg-card/50 hover:bg-muted text-foreground gap-2 font-medium border-border h-9 relative z-20"
        variant="outline"
        onClick={onToggle}
        disabled={loading}
      >
        {selectedToken ? <TokenIcon token={selectedToken} /> : <div className="w-5 h-5 rounded-full bg-muted" />}
        {selectedToken?.symbol || "Select"}
        <ChevronDown className={`h-4 w-4 transition-transform ${dropDirection === "up" ? "rotate-180" : ""}`} />
      </Button>

      {show && (
        <div 
          className={`absolute ${
            dropDirection === "up" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]"
          } right-0 bg-card border border-border rounded-lg p-2 min-w-[250px] z-[9999] backdrop-blur-sm max-h-[240px] overflow-y-auto shadow-lg`}
          style={{ 
            position: 'absolute',
            [dropDirection === "up" ? "bottom" : "top"]: "100%",
            right: dropDirection === "up" ? "-20px" : "0",
            marginTop: dropDirection === "down" ? "8px" : undefined,
            marginBottom: dropDirection === "up" ? "8px" : undefined,
            transform: dropDirection === "up" ? "translateY(-8px)" : undefined
          }}
        >
          {loading ? (
            <div className="text-center py-6 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-3" />
              <div className="text-sm">Loading tokens...</div>
            </div>
          ) : tokens.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground">
              <div className="text-sm">No tokens available</div>
            </div>
          ) : (
            <div className="space-y-1">
              {tokens.map((token) => (
                <button
                  key={token.address}
                  className="w-full flex items-center gap-3 p-2 hover:bg-muted/50 rounded text-left text-foreground transition-colors"
                  onClick={() => {
                    onSelect(token)
                    onToggle()
                    setSwapResult(null)
                    setToAmount("")
                  }}
                >
                  <TokenIcon token={token} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{token.symbol}</div>
                    <div className="text-xs text-muted-foreground truncate">{token.name}</div>
                    <div className="text-xs text-muted-foreground/60 font-mono truncate">
                      {token.address.slice(0, 8)}...{token.address.slice(-6)}
                    </div>
                  </div>
                  {selectedToken?.address === token.address && (
                    <Check className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/80 dark:from-purple-400 dark:via-pink-400 dark:to-blue-400 text-transparent bg-clip-text mb-1">
            Cross-Chain Swap
          </h1>
          <p className="text-muted-foreground dark:text-white/60">
            Bridge tokens across different blockchains • {supportedPairs.length} pairs • {supportedBridges.length}{" "}
            bridges
          </p>
          {rateLimitInfo.requestCount > 0 && (
            <p className="text-xs text-muted-foreground/60 dark:text-white/40 mt-1">
              API Requests made: {rateLimitInfo.requestCount} • Rate limit protection active
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-border dark:border-white/20 hover:bg-accent dark:hover:bg-white/10 text-foreground dark:text-white gap-2"
            onClick={() => setShowSupportedPairs(!showSupportedPairs)}
            disabled={supportedPairs.length === 0}
          >
            <Sparkles className="h-4 w-4" />
            View Supported Pairs
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full border-border dark:border-white/20 hover:bg-accent dark:hover:bg-white/10 text-foreground dark:text-white"
            onClick={handleRefreshData}
            disabled={isLoading || rateLimitInfo.isRateLimited}
          >
            {rateLimitInfo.isRateLimited ? (
              <Clock className="h-4 w-4" />
            ) : (
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            )}
          </Button>
        </div>
      </div>

      {/* Rate Limit Warning */}
      {rateLimitInfo.isRateLimited && (
        <Card className="mb-6 bg-amber-100 dark:bg-amber-900/20 border-amber-300 dark:border-amber-500/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <div>
                <div className="text-amber-800 dark:text-amber-400 font-medium">Rate Limit Active</div>
                <div className="text-sm text-amber-700 dark:text-amber-200">
                  Please wait {getRateLimitCountdown()} seconds before making more requests
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Enhanced Loading Progress */}
      {isLoading && (
        <Card className="mb-6 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border-purple-200 dark:border-purple-500/30">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <Loader2 className="h-6 w-6 animate-spin text-purple-600 dark:text-purple-400" />
              <div className="flex-1">
                <div className="text-foreground dark:text-white font-medium mb-2">{loadingState.currentStep}</div>
                <div className="w-full bg-muted dark:bg-white/10 rounded-full h-3">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-blue-500 h-3 rounded-full transition-all duration-1000 ease-out"
                    style={{ width: `${loadingState.progress}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground dark:text-white/60 mt-2">
                  <span>
                    Step {loadingState.currentStepIndex} of {loadingState.totalSteps}
                  </span>
                  <span>{loadingState.progress}% complete</span>
                </div>
              </div>
            </div>
            <div className="mt-4 text-xs text-muted-foreground/60 dark:text-white/40">
              ⏳ Using 5-second delays between requests to prevent rate limiting
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Swap Interface */}
        <div className="lg:col-span-2">
          {/* Pair Validation Status */}
          {fromToken && toToken && (
            <Card
              className={`mb-4 ${pairValidation.isValid ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-500/30" : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-500/30"}`}
            >
              <CardContent className="p-4">
                <div
                  className={`flex items-center gap-2 text-sm ${pairValidation.isValid ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`}
                >
                  {pairValidation.isValid ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                  <span>{pairValidation.message}</span>
                </div>
                {pairValidation.availableBridges.length > 0 && (
                  <div className="mt-2 text-xs text-muted-foreground dark:text-white/60">
                    Available bridges: {pairValidation.availableBridges.map((b) => b.bridgeName).join(", ")}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Swap Interface */}
          <div className="backdrop-blur-sm bg-card/50 border border-border rounded-xl overflow-hidden hover:border-border/80 transition-all hover:shadow-xl">
            <div className="p-6">
              {/* From Token */}
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-muted-foreground">From</span>
                <ChainSelector
                  chains={chainList}
                  selectedChain={fromChain}
                  onSelect={(chain) => {
                    setFromChain(chain)
                    setFromToken(null)
                  }}
                  show={showFromChains}
                  onToggle={() => setShowFromChains(!showFromChains)}
                  dropDirection="down"
                />
              </div>

              <div className="flex items-center gap-3 mb-6">
                <div className="flex-1">
                  <TokenSelector
                    tokens={fromTokens}
                    selectedToken={fromToken}
                    onSelect={setFromToken}
                    show={showFromTokens}
                    onToggle={() => setShowFromTokens(!showFromTokens)}
                    loading={loadingState.fromTokens}
                    dropDirection="down"
                  />
                </div>
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="0.0"
                    value={fromAmount}
                    onChange={(e) => setFromAmount(e.target.value)}
                    className="w-full bg-card/50 border border-border rounded-lg px-4 py-2 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              {/* Swap Direction Button */}
              <div className="flex justify-center -my-3 relative z-10">
                <Button
                  onClick={handleSwapChains}
                  size="icon"
                  className="rounded-full h-10 w-10 bg-card hover:bg-muted border border-border"
                  disabled={isLoading}
                >
                  <ArrowRightLeft className="h-5 w-5 text-foreground" />
                </Button>
              </div>

              {/* To Token */}
              <div className="flex justify-between items-center mb-2 mt-6">
                <span className="text-sm text-muted-foreground">To</span>
                <ChainSelector
                  chains={chainList}
                  selectedChain={toChain}
                  onSelect={(chain) => {
                    setToChain(chain)
                    setToToken(null)
                  }}
                  show={showToChains}
                  onToggle={() => setShowToChains(!showToChains)}
                  dropDirection="up"
                />
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <TokenSelector
                    tokens={toTokens}
                    selectedToken={toToken}
                    onSelect={setToToken}
                    show={showToTokens}
                    onToggle={() => setShowToTokens(!showToTokens)}
                    loading={loadingState.toTokens}
                    dropDirection="up"
                  />
                </div>
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="0.0"
                    value={toAmount}
                    readOnly
                    className="w-full bg-card/50 border border-border rounded-lg px-4 py-2 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring cursor-not-allowed"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Bridge Settings */}
          <div className="mt-6 space-y-4">
            <div className="backdrop-blur-sm bg-background/50 dark:bg-black/20 border border-border dark:border-white/10 rounded-xl p-5 hover:border-border/80 dark:hover:border-white/20 transition-all hover:shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-foreground dark:text-white/80 font-medium">Bridge Settings</span>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-muted-foreground dark:text-white/60">Slippage Tolerance</span>
                    <button className="text-muted-foreground/40 dark:text-white/40 hover:text-muted-foreground/60 dark:hover:text-white/60">
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {["0.002", "0.01", "0.025", "0.05"].map((value) => (
                      <Button
                        key={value}
                        variant="outline"
                        size="sm"
                        className={`h-7 px-2.5 py-1 border-border dark:border-white/20 text-foreground dark:text-white text-xs ${
                          slippage === value ? "bg-accent dark:bg-purple-500/20 border-accent dark:border-purple-500/40" : "hover:bg-accent/50 dark:hover:bg-white/10"
                        }`}
                        onClick={() => setSlippage(value)}
                      >
                        {Number.parseFloat(value) * 100}%
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground dark:text-white/60">Route Optimization</span>
                  <div className="relative">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-border dark:border-white/20 hover:bg-background/10 text-foreground dark:text-white text-xs h-7 gap-2"
                      onClick={() => setShowRouteOptions(!showRouteOptions)}
                    >
                      {routeOptions.find((r) => r.value === routeSort)?.label}
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                    {showRouteOptions && (
                      <div className="absolute top-full mt-2 right-0 bg-black/90 border border-white/20 rounded-lg p-2 min-w-[200px] z-50 backdrop-blur-sm">
                        {routeOptions.map((option) => (
                          <button
                            key={option.value}
                            className="w-full text-left p-2 hover:bg-background/10 rounded text-foreground text-sm"
                            onClick={() => {
                              setRouteSort(option.value)
                              setShowRouteOptions(false)
                            }}
                          >
                            <div className="font-medium">{option.label}</div>
                            <div className="text-xs text-foreground/60">{option.description}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground dark:text-white/60">Bridge Fee</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={feePercent}
                      onChange={(e) => setFeePercent(e.target.value)}
                      className="w-16 px-2 py-1 bg-background dark:bg-black/50 border border-border dark:border-white/20 rounded text-foreground text-xs text-right"
                      placeholder="0.1"
                    />
                    <span className="text-xs text-foreground/60">%</span>
                  </div>
                </div>

                {/* Recipient Address Section */}
                <div className="space-y-3 pt-2 border-t border-border dark:border-white/10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-foreground dark:text-white/60">Recipient Address</span>
                      <button className="text-muted-foreground/40 dark:text-white/40 hover:text-muted-foreground/60 dark:hover:text-white/60">
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="text-xs text-orange-400 font-medium">
                      REQUIRED
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={recipientAddress}
                      onChange={(e) => setRecipientAddress(e.target.value)}
                      className="w-full px-3 py-2 bg-background dark:bg-black/50 border border-border dark:border-white/20 rounded text-foreground text-sm"
                      placeholder={`Enter ${toChain.name} address (${toChain.index === "501" ? "Base58" : "0x..."})`}
                    />
                    {recipientAddress && !validateRecipientAddress(recipientAddress, toChain) && (
                      <div className="text-xs text-red-400 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Invalid {toChain.name} address format
                      </div>
                    )}
                    {recipientAddress && validateRecipientAddress(recipientAddress, toChain) && (
                      <div className="text-xs text-green-400 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Valid {toChain.name} address
                      </div>
                    )}
                    <div className="text-xs text-foreground/40">
                      Tokens will be sent to this address on {toChain.name}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Route Selector */}
          <div className="p-4 border-t border-border">
            <div className="flex items-center gap-2 mb-2">
              <Info className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Select Route</span>
            </div>
            <div className="space-y-2">
              {routeOptions.map((option) => (
                <button
                  key={option.value}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    routeSort === option.value
                      ? "bg-accent border-accent text-accent-foreground"
                      : "bg-card/50 border-border hover:bg-muted/50"
                  }`}
                  onClick={() => setRouteSort(option.value)}
                >
                  <div className="flex-1 text-left">
                    <div className="font-medium text-foreground">{option.label}</div>
                    <div className="text-sm text-muted-foreground">{option.description}</div>
                  </div>
                  {routeSort === option.value && <Check className="h-4 w-4 text-accent-foreground" />}
                </button>
              ))}
            </div>
          </div>

          {/* Swap Button */}
          <div className="p-4 border-t border-border">
            <Button
              className="w-full bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-medium h-12"
              disabled={!fromToken || !toToken || !fromAmount || isLoading || rateLimitInfo.isRateLimited}
              onClick={handleBuildTransaction}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Building Transaction...
                </>
              ) : rateLimitInfo.isRateLimited ? (
                <>
                  <Clock className="h-4 w-4 mr-2" />
                  Rate Limited ({getRateLimitCountdown()}s)
                </>
              ) : !fromToken || !toToken ? (
                "Select Tokens"
              ) : !fromAmount ? (
                "Enter Amount"
              ) : (
                "Build Transaction"
              )}
            </Button>
          </div>
        </div>

        {/* Sidebar - Current Chain Pairs */}
        <div className="space-y-4">
          <Card className="bg-background dark:bg-black/20 border-border dark:border-white/10 hover:border-border/80 dark:hover:border-white/20 transition-all hover:shadow-xl">
            <CardHeader>
              <CardTitle className="text-lg text-foreground flex items-center gap-2">
                <Link className="h-5 w-5" />
                Current Route Pairs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {getCurrentChainPairs().length === 0 ? (
                  <div className="text-center py-6 text-foreground/60">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-3 text-amber-400" />
                    <div className="text-sm">No supported pairs for this route</div>
                    <div className="text-xs text-foreground/40 mt-1">
                      {fromChain.name} → {toChain.name}
                    </div>
                  </div>
                ) : (
                  getCurrentChainPairs().map((pair, index) => (
                    <div
                      key={pair.pairId}
                      className="p-3 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-lg border border-purple-500/20 hover:border-purple-500/40 transition-all duration-300 hover:scale-[1.02]"
                      style={{ animationDelay: `${index * 100}ms` }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 flex items-center justify-center text-foreground text-xs font-bold">
                            {pair.fromTokenSymbol.slice(0, 1)}
                          </div>
                          <ArrowRightLeft className="h-3 w-3 text-foreground/60" />
                          <div className="w-6 h-6 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 flex items-center justify-center text-foreground text-xs font-bold">
                            {pair.toTokenSymbol.slice(0, 1)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-foreground font-medium text-sm">
                            {pair.fromTokenSymbol} → {pair.toTokenSymbol}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Available Bridges */}
          <Card className="bg-background dark:bg-black/20 border-border dark:border-white/10 hover:border-border/80 dark:hover:border-white/20 transition-all hover:shadow-xl">
            <CardHeader>
              <CardTitle className="text-lg text-foreground flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Available Bridges
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {pairValidation.availableBridges.length === 0 ? (
                  <div className="text-center py-4 text-foreground/60">
                    <div className="text-sm">No bridges available</div>
                    <div className="text-xs text-foreground/40 mt-1">Select a valid token pair</div>
                  </div>
                ) : (
                  pairValidation.availableBridges.map((bridge, index) => (
                    <div
                      key={bridge.bridgeId}
                      className="p-3 bg-gradient-to-r from-green-500/10 to-emerald-500/10 rounded-lg border border-green-500/20 hover:border-green-500/40 transition-all duration-300"
                      style={{ animationDelay: `${index * 100}ms` }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-r from-green-500 to-emerald-500 flex items-center justify-center text-foreground text-xs font-bold">
                            {bridge.bridgeName.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-foreground font-medium text-sm">{bridge.bridgeName}</div>
                            <div className="text-xs text-foreground/60">
                              {bridge.requireOtherNativeFee ? "Requires native fee" : "No native fee"}
                            </div>
                          </div>
                        </div>
                        <div className="text-xs text-green-400">#{bridge.bridgeId}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Supported Pairs Modal */}
      {showSupportedPairs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-black/90 rounded-xl shadow-2xl border border-white/20 relative max-w-6xl w-full mx-4 max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-white/10">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold bg-gradient-to-r from-foreground to-foreground/80 text-transparent bg-clip-text">
                  Supported Token Pairs
                </h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowSupportedPairs(false)}
                  className="text-foreground/70 hover:text-foreground hover:bg-foreground/10"
                >
                  <Copy className="h-5 w-5 rotate-45" />
                </Button>
              </div>
              <p className="text-foreground/60 mt-2">
                {supportedPairs.length} supported token pairs across {getChainCombinations().length} chain routes
              </p>
            </div>

            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {getChainCombinations().map((combination, index) => (
                  <Card
                    key={`${combination.from.index}-${combination.to.index}`}
                    className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 border-purple-500/30 hover:border-purple-500/50 transition-all duration-300 hover:scale-[1.02]"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded-full bg-gradient-to-r ${combination.from.color} flex items-center justify-center`}
                          >
                            <span className="text-foreground text-xs font-bold">{combination.from.name.slice(0, 2)}</span>
                          </div>
                          <ArrowRightLeft className="h-4 w-4 text-foreground/60" />
                          <div
                            className={`w-8 h-8 rounded-full bg-gradient-to-r ${combination.to.color} flex items-center justify-center`}
                          >
                            <span className="text-foreground text-xs font-bold">{combination.to.name.slice(0, 2)}</span>
                          </div>
                        </div>
                        <div className="text-xs text-purple-400 font-medium">{combination.pairs.length} pairs</div>
                      </div>
                      <div className="text-foreground font-medium">
                        {combination.from.name} → {combination.to.name}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="space-y-2">
                        {combination.pairs.slice(0, 3).map((pair: TokenPair) => (
                          <div
                            key={pair.pairId}
                            className="flex items-center justify-between p-2 bg-background rounded text-sm"
                          >
                            <span className="text-foreground/80">
                              {pair.fromTokenSymbol} → {pair.toTokenSymbol}
                            </span>
                          </div>
                        ))}
                        {combination.pairs.length > 3 && (
                          <div className="text-xs text-foreground/60 text-center py-1">
                            +{combination.pairs.length - 3} more pairs
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <Card className="mt-4 bg-red-900/20 border-red-500/30">
          <CardContent className="p-4">
            <div className="text-red-400 text-sm">
              <strong>Error:</strong> {error}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Swap Result */}
      {swapResult && (
        <Card className={`mt-4 ${swapResult.success ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-4">
              {swapResult.success ? (
                <CheckCircle className="h-5 w-5 text-emerald-500" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-rose-500" />
              )}
              <div>
                <div className={`font-medium ${swapResult.success ? "text-emerald-700" : "text-rose-700"}`}>
                  {swapResult.success ? "Transaction Built Successfully" : "Transaction Build Failed"}
                </div>
                <div className={`text-sm ${swapResult.success ? "text-emerald-600" : "text-rose-600"}`}>
                  {swapResult.msg}
                </div>
              </div>
            </div>

            {swapResult.success && swapResult.data[0] && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">You Pay</span>
                  <span className="text-foreground font-medium">
                    {formatDisplayAmount(swapResult.data[0].fromTokenAmount, fromToken?.decimals || 18)} {fromToken?.symbol}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">You Receive (Estimated)</span>
                  <span className="text-foreground font-medium">
                    {formatDisplayAmount(swapResult.data[0].toTokenAmount, toToken?.decimals || 18)} {toToken?.symbol}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Minimum Received</span>
                  <span className="text-foreground font-medium">
                    {formatDisplayAmount(swapResult.data[0].minmumReceive, toToken?.decimals || 18)} {toToken?.symbol}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Bridge</span>
                  <span className="text-foreground font-medium">{swapResult.data[0].router.bridgeName}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Bridge Fee</span>
                  <span className="text-foreground font-medium">
                    {formatDisplayAmount(swapResult.data[0].router.crossChainFee, 18)} {fromToken?.symbol}
                  </span>
                </div>
                {swapResult.data[0].router.otherNativeFee !== "0" && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Native Fee</span>
                    <span className="text-foreground font-medium">
                      {formatDisplayAmount(swapResult.data[0].router.otherNativeFee, 18)} {fromToken?.symbol}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Gas Limit</span>
                  <span className="text-foreground font-medium">{swapResult.data[0].tx.gasLimit}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Gas Price</span>
                  <span className="text-foreground font-medium">
                    {formatDisplayAmount(swapResult.data[0].tx.gasPrice, 9)} GWEI
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="mt-5 text-center">
        <p className="text-xs text-foreground/40">
          Powered by OKX Cross-Chain Bridge Aggregator. Secure multi-chain token transfers.
        </p>
      </div>
    </div>
  )
}

function TokenIcon({ token }: { token: Token }) {
  // If token has a logo URL, use it
  if (token.logoUrl && token.hasLogo) {
    return (
      <div className="w-5 h-5 rounded-full overflow-hidden bg-background flex items-center justify-center">
        <img
          src={token.logoUrl || "/placeholder.svg"}
          alt={token.symbol}
          className="w-full h-full object-cover"
          onError={(e) => {
            // Fallback to gradient if image fails to load
            const target = e.target as HTMLImageElement
            target.style.display = "none"
            target.parentElement!.innerHTML = `<div class="w-5 h-5 rounded-full ${getTokenGradient(token.symbol)} flex items-center justify-center text-foreground text-xs font-bold">${token.symbol.slice(0, 2)}</div>`
          }}
        />
      </div>
    )
  }

  // Fallback to gradient background with token symbol
  return (
    <div
      className={`w-5 h-5 rounded-full ${getTokenGradient(token.symbol)} flex items-center justify-center text-foreground text-xs font-bold`}
    >
      {token.symbol.slice(0, 2)}
    </div>
  )
}

function getTokenGradient(symbol: string): string {
  const colors: Record<string, string> = {
    SOL: "bg-gradient-to-r from-purple-500 to-blue-500",
    ETH: "bg-gradient-to-r from-blue-600 to-purple-600",
    USDC: "bg-blue-500",
    USDT: "bg-green-500",
    RAY: "bg-gradient-to-r from-blue-400 to-purple-500",
    ORCA: "bg-gradient-to-r from-pink-400 to-purple-500",
    WBTC: "bg-orange-500",
    DAI: "bg-yellow-500",
    BNB: "bg-gradient-to-r from-yellow-500 to-orange-500",
    MATIC: "bg-gradient-to-r from-purple-600 to-pink-500",
    AVAX: "bg-gradient-to-r from-red-600 to-orange-500",
    FTM: "bg-gradient-to-r from-blue-400 to-cyan-400",
  }
  return colors[symbol] || "bg-gradient-to-r from-gray-500 to-gray-600"
}
