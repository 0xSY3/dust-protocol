"use client";

import { useState, ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Box, Text, VStack, HStack, Input, Textarea } from "@chakra-ui/react";
import { useAuth } from "@/contexts/AuthContext";
import { usePaymentLinks } from "@/hooks/stealth/usePaymentLinks";
import { colors, radius, shadows } from "@/lib/design/tokens";
import {
  WalletIcon, BoxIcon, SendIcon, RefreshIcon,
  ChevronDownIcon, ChevronUpIcon, MailIcon, UserIcon, MessageCircleIcon,
  ArrowLeftIcon, InfoIcon, CheckIcon,
} from "@/components/stealth/icons";

const EMOJI_LIST = [
  "🎨", "🎸", "🎭", "🎪", "🍕", "🍔", "🍩", "🎂",
  "☕", "🌟", "💎", "🔥", "🎯", "🎮", "📸", "🎵",
  "🌈", "🦄", "🐱", "🐶", "💡", "🚀", "💰", "🎁",
  "❤️", "🌊", "🏆", "⚡", "🎤", "🛒", "📚", "🎬",
];

const BG_COLORS = [
  "#F9A8D4", "#FCA5A5", "#FCD34D", "#86EFAC",
  "#5EEAD4", "#93C5FD", "#A5B4FC", "#C4B5FD",
];

const TEMPLATES = [
  {
    id: "simple",
    name: "Simple Payment",
    tagline: '"Just send me money!"',
    desc: "Basic payment link. Share it, get paid.",
    perfect: "Everything else",
    icon: WalletIcon,
    iconBg: "linear-gradient(135deg, #86EFAC 0%, #34D399 100%)",
    iconColor: "#fff",
    borderColor: "#34D399",
    available: true,
  },
  {
    id: "digital",
    name: "Digital Product",
    tagline: '"Buy my design pack - $25"',
    desc: "Sell digital files with instant delivery.",
    perfect: "Selling digital stuff",
    icon: BoxIcon,
    iconBg: "linear-gradient(135deg, #C4B5FD 0%, #A78BFA 100%)",
    iconColor: "#fff",
    borderColor: "#A78BFA",
    available: false,
  },
  {
    id: "request",
    name: "Payment Request",
    tagline: '"You owe me $50"',
    desc: "Ask someone specific to pay you.",
    perfect: "When someone owes you",
    icon: SendIcon,
    iconBg: "linear-gradient(135deg, #93C5FD 0%, #60A5FA 100%)",
    iconColor: "#fff",
    borderColor: "#60A5FA",
    available: false,
  },
  {
    id: "fundraiser",
    name: "Fundraiser",
    tagline: '"Help me reach $1,000!"',
    desc: "Collect money toward a goal with progress bar.",
    perfect: "Raising funds for something",
    icon: RefreshIcon,
    iconBg: "linear-gradient(135deg, #86EFAC 0%, #34D399 100%)",
    iconColor: "#fff",
    borderColor: "#34D399",
    available: false,
  },
];

export default function CreateLinkPage() {
  const router = useRouter();
  const { ownedNames } = useAuth();
  const { createLink } = usePaymentLinks();

  const [step, setStep] = useState<"template" | "form">("template");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("🎨");
  const [emojiBg, setEmojiBg] = useState(BG_COLORS[0]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [collectEmail, setCollectEmail] = useState(false);
  const [collectName, setCollectName] = useState(false);
  const [collectTelegram, setCollectTelegram] = useState(false);

  const username = ownedNames[0]?.name || "";

  const handleCreate = () => {
    if (!name.trim()) return;
    const slug = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
    createLink({ name: name.trim(), slug, description, emoji, emojiBg });
    router.push("/links");
  };

  if (step === "template") {
    return (
      <Box p={{ base: "20px 16px", md: "40px" }} maxW="680px" mx="auto">
        <VStack gap="28px" align="stretch">
          <HStack gap="16px" align="center">
            <Box as="button" p="8px" borderRadius={radius.full} _hover={{ bgColor: colors.bg.input }}
              onClick={() => router.push("/links")}>
              <ArrowLeftIcon size={20} color={colors.text.secondary} />
            </Box>
            <Text fontSize="24px" fontWeight={700} color={colors.text.primary}>Create Link</Text>
          </HStack>

          <VStack gap="8px" align="flex-start">
            <HStack gap="8px">
              <Text fontSize="18px" fontWeight={600} color={colors.text.primary}>Choose a Template</Text>
              <InfoIcon size={16} color={colors.text.muted} />
            </HStack>
            <Text fontSize="14px" color={colors.text.muted}>Pick the perfect template for your payment link.</Text>
          </VStack>

          {/* Popular */}
          <VStack gap="12px" align="stretch">
            <Text fontSize="15px" fontWeight={600} color={colors.text.primary}>Popular</Text>
            {TEMPLATES.slice(0, 3).map((t) => {
              const Icon = t.icon;
              return (
                <Box key={t.id} position="relative" overflow="hidden"
                  bgColor={colors.bg.card} borderRadius={radius.lg}
                  border={t.available ? `2.5px solid ${t.borderColor}` : `2px solid ${colors.border.default}`}
                  cursor={t.available ? "pointer" : "default"}
                  opacity={t.available ? 1 : 0.55}
                  _hover={t.available ? { boxShadow: `0 4px 20px ${t.borderColor}30`, transform: "translateY(-1px)" } : {}}
                  transition="all 0.2s ease"
                  onClick={() => t.available && setStep("form")}
                >
                  {/* Colored accent strip */}
                  {t.available && (
                    <Box position="absolute" left="0" top="0" bottom="0" w="4px" bg={t.iconBg} />
                  )}
                  <Box p="20px 24px" pl={t.available ? "28px" : "24px"}>
                    <HStack gap="20px" align="flex-start">
                      <Box w="52px" h="52px" borderRadius={radius.full} bg={t.iconBg}
                        display="flex" alignItems="center" justifyContent="center" flexShrink={0}
                        boxShadow={`0 4px 12px ${t.borderColor}40`}>
                        <Icon size={24} color={t.iconColor} />
                      </Box>
                      <VStack gap="4px" align="flex-start" flex={1}>
                        <HStack gap="10px" flexWrap="wrap">
                          <Text fontSize="15px" fontWeight={600} color={colors.text.primary}>{t.name}</Text>
                          <Text fontSize="12px" color={colors.text.muted} fontStyle="italic">{t.tagline}</Text>
                        </HStack>
                        <Text fontSize="13px" color={colors.text.tertiary}>{t.desc}</Text>
                        <Text fontSize="12px" color={t.available ? t.borderColor : colors.text.muted} fontWeight={500}>
                          Perfect for: {t.perfect}
                        </Text>
                      </VStack>
                      {!t.available && (
                        <Box px="12px" py="5px" bgColor={colors.bg.input} borderRadius={radius.full} flexShrink={0}>
                          <Text fontSize="11px" fontWeight={600} color={colors.text.muted}>Coming Soon</Text>
                        </Box>
                      )}
                    </HStack>
                  </Box>
                </Box>
              );
            })}
          </VStack>

          {/* More Options */}
          <VStack gap="12px" align="stretch">
            <Text fontSize="15px" fontWeight={600} color={colors.text.primary}>More Options</Text>
            {TEMPLATES.slice(3).map((t) => {
              const Icon = t.icon;
              return (
                <Box key={t.id} p="20px 24px" bgColor={colors.bg.card} borderRadius={radius.lg}
                  border={`2px solid ${colors.border.default}`} opacity={0.55}>
                  <HStack gap="20px" align="flex-start">
                    <Box w="52px" h="52px" borderRadius={radius.full} bg={t.iconBg}
                      display="flex" alignItems="center" justifyContent="center" flexShrink={0}>
                      <Icon size={24} color={t.iconColor} />
                    </Box>
                    <VStack gap="4px" align="flex-start" flex={1}>
                      <HStack gap="10px" flexWrap="wrap">
                        <Text fontSize="15px" fontWeight={600} color={colors.text.primary}>{t.name}</Text>
                        <Text fontSize="12px" color={colors.text.muted} fontStyle="italic">{t.tagline}</Text>
                      </HStack>
                      <Text fontSize="13px" color={colors.text.tertiary}>{t.desc}</Text>
                      <Text fontSize="12px" color={colors.text.muted}>Perfect for: {t.perfect}</Text>
                    </VStack>
                    <Box px="12px" py="5px" bgColor={colors.bg.input} borderRadius={radius.full} flexShrink={0}>
                      <Text fontSize="11px" fontWeight={600} color={colors.text.muted}>Coming Soon</Text>
                    </Box>
                  </HStack>
                </Box>
              );
            })}
          </VStack>
        </VStack>
      </Box>
    );
  }

  // Step 2: Form
  return (
    <Box p={{ base: "20px 16px", md: "40px" }} maxW="680px" mx="auto">
      <VStack gap="32px" align="stretch">
        <HStack gap="16px" align="center">
          <Box as="button" p="8px" borderRadius={radius.full} _hover={{ bgColor: colors.bg.input }}
            onClick={() => setStep("template")}>
            <ArrowLeftIcon size={20} color={colors.text.secondary} />
          </Box>
          <Text fontSize="24px" fontWeight={700} color={colors.text.primary}>Create Link</Text>
        </HStack>

        {/* Link Name & Style */}
        <VStack gap="16px" align="stretch">
          <Text fontSize="16px" fontWeight={600} color={colors.text.primary}>Link Name & Style</Text>
          <HStack gap="20px" align="center">
            {/* Emoji picker trigger */}
            <Box position="relative">
              <Box
                as="button"
                w="72px" h="72px" borderRadius={radius.full} bgColor={emojiBg}
                display="flex" alignItems="center" justifyContent="center"
                cursor="pointer" fontSize="32px" position="relative"
                boxShadow={`0 4px 16px ${emojiBg}80`}
                _hover={{ transform: "scale(1.05)" }}
                transition="all 0.2s ease"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              >
                {emoji}
                {/* Edit badge */}
                <Box position="absolute" bottom="-2px" right="-2px"
                  w="24px" h="24px" borderRadius={radius.full}
                  bgColor={colors.bg.card} border={`2px solid ${colors.border.default}`}
                  display="flex" alignItems="center" justifyContent="center">
                  <Text fontSize="10px">✏️</Text>
                </Box>
              </Box>
              {/* Emoji picker dropdown */}
              {showEmojiPicker && (
                <Box position="absolute" top="80px" left="0" zIndex={50}
                  bgColor={colors.bg.card} borderRadius={radius.lg}
                  border={`2px solid ${colors.border.default}`}
                  boxShadow={shadows.modal} p="16px" w="300px">
                  <VStack gap="14px" align="stretch">
                    <Text fontSize="12px" fontWeight={600} color={colors.text.secondary}>Background Color</Text>
                    <HStack gap="10px" flexWrap="wrap">
                      {BG_COLORS.map((bg) => (
                        <Box key={bg} as="button" w="32px" h="32px" borderRadius={radius.full}
                          bgColor={bg} cursor="pointer" transition="all 0.15s ease"
                          border={emojiBg === bg ? `3px solid ${colors.accent.indigo}` : "2px solid transparent"}
                          boxShadow={emojiBg === bg ? `0 2px 8px ${bg}80, ${colors.glow.indigo}` : "none"}
                          _hover={{ transform: "scale(1.15)" }}
                          onClick={() => setEmojiBg(bg)} />
                      ))}
                    </HStack>
                    <Box h="1px" bgColor={colors.border.default} />
                    <Text fontSize="12px" fontWeight={600} color={colors.text.secondary}>Choose Emoji</Text>
                    <Box display="flex" flexWrap="wrap" gap="4px">
                      {EMOJI_LIST.map((e) => (
                        <Box key={e} as="button" w="36px" h="36px" borderRadius={radius.sm}
                          display="flex" alignItems="center" justifyContent="center"
                          cursor="pointer" fontSize="20px" transition="all 0.1s ease"
                          bgColor={emoji === e ? colors.bg.input : "transparent"}
                          _hover={{ bgColor: colors.bg.input, transform: "scale(1.1)" }}
                          onClick={() => { setEmoji(e); setShowEmojiPicker(false); }}>
                          {e}
                        </Box>
                      ))}
                    </Box>
                  </VStack>
                </Box>
              )}
            </Box>
            <Input
              placeholder="e.g., Coffee Tips"
              value={name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              flex={1} h="52px" px="16px"
              bgColor={colors.bg.input} border={`2px solid ${colors.border.default}`} borderRadius={radius.md}
              fontSize="16px" fontWeight={500} color={colors.text.primary}
              _placeholder={{ color: colors.text.muted }}
              _focus={{ borderColor: colors.accent.indigo, boxShadow: colors.glow.indigo }}
            />
          </HStack>
        </VStack>

        {/* Description */}
        <VStack gap="10px" align="stretch">
          <Text fontSize="16px" fontWeight={600} color={colors.text.primary}>Description (Optional)</Text>
          <Textarea
            placeholder="Tell people what this payment is for..."
            value={description}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
            bgColor={colors.bg.input} border={`2px solid ${colors.border.default}`} borderRadius={radius.md}
            fontSize="14px" color={colors.text.primary} minH="120px" p="16px"
            _placeholder={{ color: colors.text.muted }}
            _focus={{ borderColor: colors.accent.indigo, boxShadow: colors.glow.indigo }}
            resize="vertical"
          />
        </VStack>

        {/* Amount */}
        <Box p="20px 24px" bgColor="rgba(43, 90, 226, 0.04)" borderRadius={radius.lg}
          border={`2px solid rgba(43, 90, 226, 0.15)`}>
          <VStack gap="8px" align="flex-start">
            <Text fontSize="16px" fontWeight={600} color={colors.accent.indigo}>Amount</Text>
            <Text fontSize="14px" color={colors.text.secondary} lineHeight="1.6">
              <Text as="span" fontWeight={600} color={colors.accent.indigo}>Open Amount:</Text> Let customers choose their own amount - perfect for tips and donations!
            </Text>
          </VStack>
        </Box>

        {/* Advanced */}
        <VStack gap="0" align="stretch">
          <Text fontSize="16px" fontWeight={600} color={colors.text.primary} mb="12px">Advanced</Text>
          <Box
            p="16px 20px" bgColor={colors.bg.card}
            borderRadius={showAdvanced ? `${radius.lg} ${radius.lg} 0 0` : radius.lg}
            border={`2px solid ${colors.border.default}`}
            cursor="pointer"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <HStack justify="space-between" align="center">
              <HStack gap="14px">
                <Box w="40px" h="40px" borderRadius={radius.full}
                  bg="linear-gradient(135deg, #A5B4FC 0%, #818CF8 100%)"
                  display="flex" alignItems="center" justifyContent="center"
                  boxShadow="0 2px 8px rgba(129, 140, 248, 0.3)">
                  <UserIcon size={18} color="#fff" />
                </Box>
                <VStack gap="2px" align="flex-start">
                  <Text fontSize="14px" fontWeight={500} color={colors.text.primary}>Collect Payer Info</Text>
                  <Text fontSize="12px" color={colors.text.muted}>Gather additional information from customers</Text>
                </VStack>
              </HStack>
              {showAdvanced
                ? <ChevronUpIcon size={18} color={colors.text.muted} />
                : <ChevronDownIcon size={18} color={colors.text.muted} />
              }
            </HStack>
          </Box>

          {showAdvanced && (
            <Box px="20px" pb="20px" pt="16px" bgColor={colors.bg.card}
              borderRadius={`0 0 ${radius.lg} ${radius.lg}`}
              borderLeft={`2px solid ${colors.border.default}`}
              borderRight={`2px solid ${colors.border.default}`}
              borderBottom={`2px solid ${colors.border.default}`}
            >
              <Text fontSize="13px" color={colors.text.tertiary} mb="16px">
                Select the information you&apos;d like to collect from customers during payment:
              </Text>
              <VStack gap="10px" align="stretch">
                {/* Email */}
                <HStack p="14px 16px" justify="space-between" bgColor={colors.bg.card}
                  borderRadius={radius.md} border={`2px solid ${collectEmail ? "rgba(43, 90, 226, 0.3)" : colors.border.default}`}
                  transition="all 0.15s ease"
                  cursor="pointer" onClick={() => setCollectEmail(!collectEmail)}>
                  <HStack gap="14px">
                    <Box w="36px" h="36px" borderRadius={radius.full}
                      bg="linear-gradient(135deg, #FCA5A5 0%, #F87171 100%)"
                      display="flex" alignItems="center" justifyContent="center">
                      <MailIcon size={16} color="#fff" />
                    </Box>
                    <VStack gap="1px" align="flex-start">
                      <Text fontSize="14px" fontWeight={500} color={colors.text.primary}>Email Address</Text>
                      <Text fontSize="12px" color={colors.text.muted}>Get payer&apos;s email for receipts and updates</Text>
                    </VStack>
                  </HStack>
                  <Box w="24px" h="24px" borderRadius={radius.xs}
                    border={`2px solid ${collectEmail ? colors.accent.indigo : colors.border.default}`}
                    bgColor={collectEmail ? colors.accent.indigo : "transparent"}
                    display="flex" alignItems="center" justifyContent="center"
                    transition="all 0.15s ease">
                    {collectEmail && <CheckIcon size={14} color="#fff" />}
                  </Box>
                </HStack>
                {/* Name */}
                <HStack p="14px 16px" justify="space-between" bgColor={colors.bg.card}
                  borderRadius={radius.md} border={`2px solid ${collectName ? "rgba(43, 90, 226, 0.3)" : colors.border.default}`}
                  transition="all 0.15s ease"
                  cursor="pointer" onClick={() => setCollectName(!collectName)}>
                  <HStack gap="14px">
                    <Box w="36px" h="36px" borderRadius={radius.full}
                      bg="linear-gradient(135deg, #93C5FD 0%, #60A5FA 100%)"
                      display="flex" alignItems="center" justifyContent="center">
                      <UserIcon size={16} color="#fff" />
                    </Box>
                    <VStack gap="1px" align="flex-start">
                      <Text fontSize="14px" fontWeight={500} color={colors.text.primary}>Name</Text>
                      <Text fontSize="12px" color={colors.text.muted}>Collect payer&apos;s name</Text>
                    </VStack>
                  </HStack>
                  <Box w="24px" h="24px" borderRadius={radius.xs}
                    border={`2px solid ${collectName ? colors.accent.indigo : colors.border.default}`}
                    bgColor={collectName ? colors.accent.indigo : "transparent"}
                    display="flex" alignItems="center" justifyContent="center"
                    transition="all 0.15s ease">
                    {collectName && <CheckIcon size={14} color="#fff" />}
                  </Box>
                </HStack>
                {/* Telegram */}
                <HStack p="14px 16px" justify="space-between" bgColor={colors.bg.card}
                  borderRadius={radius.md} border={`2px solid ${collectTelegram ? "rgba(43, 90, 226, 0.3)" : colors.border.default}`}
                  transition="all 0.15s ease"
                  cursor="pointer" onClick={() => setCollectTelegram(!collectTelegram)}>
                  <HStack gap="14px">
                    <Box w="36px" h="36px" borderRadius={radius.full}
                      bg="linear-gradient(135deg, #5EEAD4 0%, #2DD4BF 100%)"
                      display="flex" alignItems="center" justifyContent="center">
                      <MessageCircleIcon size={16} color="#fff" />
                    </Box>
                    <VStack gap="1px" align="flex-start">
                      <Text fontSize="14px" fontWeight={500} color={colors.text.primary}>Telegram Username</Text>
                      <Text fontSize="12px" color={colors.text.muted}>Collect payer&apos;s Telegram username</Text>
                    </VStack>
                  </HStack>
                  <Box w="24px" h="24px" borderRadius={radius.xs}
                    border={`2px solid ${collectTelegram ? colors.accent.indigo : colors.border.default}`}
                    bgColor={collectTelegram ? colors.accent.indigo : "transparent"}
                    display="flex" alignItems="center" justifyContent="center"
                    transition="all 0.15s ease">
                    {collectTelegram && <CheckIcon size={14} color="#fff" />}
                  </Box>
                </HStack>
              </VStack>
              <Box mt="16px" p="12px 16px" bgColor="rgba(217, 119, 6, 0.06)" borderRadius={radius.sm}>
                <Text fontSize="12px" color={colors.accent.amber} lineHeight="1.5">
                  <Text as="span" fontWeight={600}>Tip:</Text> Collecting customer info helps you provide better service and build relationships with your customers.
                </Text>
              </Box>
            </Box>
          )}
        </VStack>

        {/* Create button */}
        <Box
          as="button"
          w="100%" p="16px"
          bg={name.trim() ? "linear-gradient(135deg, #2B5AE2 0%, #4A75F0 100%)" : colors.bg.elevated}
          borderRadius={radius.full}
          cursor={name.trim() ? "pointer" : "not-allowed"}
          boxShadow={name.trim() ? "0 4px 16px rgba(43, 90, 226, 0.35)" : "none"}
          _hover={name.trim() ? { transform: "translateY(-1px)", boxShadow: "0 6px 24px rgba(43, 90, 226, 0.4)" } : {}}
          onClick={handleCreate}
          transition="all 0.2s ease"
        >
          <Text fontSize="15px" fontWeight={600}
            color={name.trim() ? "white" : colors.text.muted} textAlign="center">
            Create Payment Link
          </Text>
        </Box>

        {username && name.trim() && (
          <Box p="12px 16px" bgColor="rgba(43, 90, 226, 0.04)" borderRadius={radius.sm} textAlign="center">
            <Text fontSize="12px" color={colors.accent.indigo}>
              Your link: <Text as="span" fontWeight={600}>{name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "")}.{username}.tok</Text>
            </Text>
          </Box>
        )}
      </VStack>
    </Box>
  );
}
