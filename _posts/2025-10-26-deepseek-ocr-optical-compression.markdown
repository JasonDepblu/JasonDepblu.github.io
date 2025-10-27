---
layout: post
title: "突破长文本魔咒：DeepSeek-OCR如何用「光学压缩」将海量文字转成视觉tokens"
date: 2025-10-26 10:00:00 +0800
reading_time: 10 min
author: Jason
categories: [OCR, VLM]
tags: [AI, OCR, DeepSeek, 视觉语言模型]
excerpt: "Paper introduces a novel vision-language model designed to efficiently compress long textual contexts into visual tokens. This system, composed of a DeepEncoder and a DeepSeek3B-MoE decoder, explores the feasibility of achieving high optical character recognition (OCR) precision—around 97%—even with high compression ratios of up to 10×. Experimental data, presented in tables and figures, demonstrates that DeepSeek-OCR achieves state-of-the-art performance on benchmarks like OmniDocBench while utilizing significantly fewer vision tokens than competing models. The paper also discusses the model's architecture, training pipelines, and practical applications, such as large-scale training data generation, highlighting its potential for addressing long-context challenges in large language models (LLMs)。"
audio: /assets/audio/突破长文本魔咒：DeepSeek-OCR如何用「光学压缩」将海量文字转成视觉tokens.m4a
---

# 目录

1.  引言：长文本的挑战与光学压缩的契机
2.  DeepSeek-OCR 的核心架构
3.  卓越的压缩性能与实战效果
4.  展望：视觉模拟的“遗忘机制”
5.  核心概念速览 (Flashcards)

***

## 1. 引言：长文本的挑战与光学压缩的契机

当前，大型语言模型（LLMs）在处理长文本内容时面临着巨大的计算挑战，主要原因在于其计算复杂性随序列长度呈二次方增长。为了解决这一瓶颈，研究人员开始探索一种潜在的解决方案：利用**视觉模态**作为文本信息的高效压缩介质。

一篇包含文档文本的图像，相较于等效的数字文本，能够用更少的**视觉标记（vision tokens）**来表示丰富的信息，这表明通过光学压缩可以实现更高的压缩比。

正是在这一背景下，DeepSeek-AI 推出了 **DeepSeek-OCR** 模型。DeepSeek-OCR 作为一项初步探索，旨在验证通过二维光学映射压缩长语境的可行性。它不仅展示了巨大的研究价值，尤其在**历史长文本压缩**和 **LLMs 记忆遗忘机制**等领域具有潜力，同时也具备极高的实际应用价值。

## 2. DeepSeek-OCR 的核心架构

DeepSeek-OCR 采用统一的端到端视觉-语言模型（VLM）架构，主要由两大部分组成：DeepEncoder（编码器）和 DeepSeek3B-MoE-A570M（解码器）。

![实验结果表格]( {{ "/assets/images/2025-10-26-deepseek-ocr-optical-compression/NotebookLM Mind Map-4.png" | relative_url }}){: img }

### DeepEncoder：实现高效压缩的核心

DeepEncoder 是 DeepSeek-OCR 的核心引擎，旨在实现高压缩比的同时，在高分辨率输入下保持低激活内存和最小的视觉标记数量。
DeepEncoder 的设计具有新颖性，它通过一个 16 倍卷积压缩器串联了两个主要的预训练编码器组件：

#### 视觉感知组件（SAM-base）
   
- 功能： 主要负责视觉感知特征提取。
- 架构基础： 采用 SAM-base 模型（Segment Anything Model）。
- 参数量： 约 80M。
- 注意力机制： 在此阶段，模型主要使用窗口注意力（window attention）。
- 优势： 由于此组件参数量较小（80M）且以窗口注意力为主，它在处理高分辨率输入时，其激活内存是可接受的。

#### 16倍卷积压缩器（Token Compressor）
   
- 位置与作用： 位于 SAM-base 组件和 CLIP-large 组件之间。
- 压缩率： 这是一个 2 层的卷积模块，用于对视觉标记进行 16 倍下采样（16× downsampling）。
- 工作机制： 假设输入 1024×1024 图像，最初会生成 4096 个图像块标记（patch tokens）。经过此压缩模块后，标记数量会减少到 4096/16=256 个。
- 目标： 这一步是确保在标记进入密集的全局注意力组件之前，标记数量得到大幅减少，从而使整体激活内存可控。

#### 视觉知识组件（CLIP-large）
   
- 功能： 主要负责视觉知识特征提取。
- 架构基础： 采用 CLIP-large 模型。
- 参数量： 约 300M。
- 注意力机制： 采用密集的全局注意力（dense global attention）。
- 输入： 它不再以图像为输入，而是以压缩器输出的 Tokens 为输入，因此其第一层图像块嵌入层被移除。
    
DeepEncoder 的总参数量约为 380M（80M SAM-base + 300M CLIP-large）。这种串联和压缩的设计，使其能够支持多分辨率输入，输出少量视觉标记，并保持低激活状态，从而满足高效上下文光学压缩的要求。
DeepEncoder 不仅支持固定的原生分辨率模式（如 Tiny、Small、Base、Large），还支持动态分辨率模式（如 Gundam 模式，用于处理超高分辨率输入）。

DeepEncoder 的架构新颖，它串联了窗口注意力（window attention）和全局注意力（global attention）编码器组件。具体来说，它利用了两个预训练模型的优势：

1.  **视觉感知组件：** 由 **SAM-base**（约 80M 参数）主导，主要负责处理密集的视觉感知任务，以窗口注意力为主。
2.  **视觉知识组件：** 由 **CLIP-large**（约 300M 参数）主导，负责提取视觉知识，采用密集的全局注意力。

在两者之间，设计了一个 **16 倍卷积压缩器**，将视觉标记的数量大幅减少（例如，将 4096 个标记压缩至 256 个），然后再进入密集的全局注意力组件。这种设计确保了在高分辨率输入下，激活内存仍可控。

### MoE 解码器

解码器采用 **DeepSeek-3B-MoE** 架构。在推理过程中，该模型激活约 570M 参数，这使得它在拥有 3B 模型表达能力的同时，享受 500M 小模型的推理效率。解码器的作用是从 DeepEncoder 输出的压缩潜在视觉标记中，重建原始文本表示。

以下是关于该解码器的详细说明：

**DeepSeek3B-MoE** 架构

以下是关于该解码器的详细说明：

1.  **基础架构**：解码器使用了 **DeepSeek-3B-MoE** 模型。
2.  **参数激活**：它是一个 Mixture-of-Experts (MoE) 架构。在**推理阶段**，该模型激活了 64 个专家中的 6 个路由专家（routed experts）和 2 个共享专家（shared experts）。
3.  **激活参数量**：推理时，总共激活的参数量约为 **570M**。
4.  **效率与能力**：DeepSeek-3B-MoE 非常适合像 OCR 这样的领域中心（domain-centric）VLM 研究。它提供了 **3B 模型**的表达能力，同时享受 **500M 小模型**的推理效率。
5.  **核心功能**：解码器的作用是从 DeepEncoder 输出的**压缩潜在视觉标记（compressed latent vision tokens, $\mathbf{Z}$）**中，**重建原始文本表示** ($\mathbf{\hat{X}}$)。这一过程被表示为非线性映射函数 $f_{dec}: \mathbf{R}^{n \times d_{\text{latent}}} \rightarrow \mathbf{R}^{N \times d_{\text{text}}}$，其中 $n$（视觉标记数） $\leq N$（重建文本标记数）。

这种设计使得 DeepSeek-OCR 能够高效地将高度压缩的视觉信息转化回完整的文本序列。

### 架构示意图 (Mind Map)

由于我们无法直接渲染图像，下面通过结构化的思维导图展示 DeepSeek-OCR 的核心组成与功能：

```mermaid
graph TD
    A[DeepSeek-OCR 架构] --> B(解决问题: LLM长文本计算瓶颈);
    A --> C(DeepEncoder: 视觉编码器, 约380M);
    A --> D(DeepSeek3B-MoE: 解码器, 约570M 激活参数);

    C --> C1(输入: 高分辨率图像);
    C --> C2(组件1: SAM-base, 80M, 窗口注意力);
    C --> C3(组件2: 16x 卷积压缩器);
    C --> C4(组件3: CLIP-large, 300M, 全局注意力);
    C --> C5(输出: 少量视觉Tokens);

    D --> D1(功能: 从压缩Tokens重建文本);
    B --> B1(优势: 实现长文本光学压缩);
    B --> B2(成果: 精度97% @ <10x 压缩);
```

## 3. 卓越的压缩性能与实战效果

DeepSeek-OCR 的实验结果有力地验证了光学压缩的可行性：

### 压缩比研究

在 Fox 基准测试中，模型展示了惊人的压缩-解压缩能力。

*   **10 倍压缩比内：** 当文本标记数量在视觉标记数量的 10 倍以内时，模型的解码精度可以达到**约 97%**。
*   **20 倍压缩比：** 即使压缩比达到 20 倍，OCR 准确率仍能保持在 **60% 左右**。

这些结果表明，紧凑的语言模型能够有效地学习解码压缩后的视觉表示。

### 实际 OCR 性能

在 OmniDocBench 上的测试结果显示了 DeepSeek-OCR 强大的实际应用能力。DeepSeek-OCR 在使用最少视觉标记的情况下，实现了端到端模型的最新性能：

*   **少量 Tokens 即可超越竞品：** DeepSeek-OCR 仅使用 **100 个视觉标记**（640x640 分辨率）就超越了使用 256 个标记的 GOT-OCR2.0。
*   **极高效率：** 在使用**不到 800 个视觉标记**（Gundam 模式）时，DeepSeek-OCR 的性能甚至优于需要近 7,000 个视觉标记的 MinerU2.0。
*   **数据生产能力：** 在实际生产中，DeepSeek-OCR 每天可以生成超过 **20 万页**的 LLM/VLM 训练数据（单张 A100-40G 显卡），或使用 20 个节点（每节点 8 个 A100-40G GPU）每天生成 **3300 万页**数据。

## 4. 展望：视觉模拟的“遗忘机制”

DeepSeek-OCR 的光学语境压缩方法不仅限于 OCR，它为解决 LLMs 的长期上下文问题提供了一个有前景的方向。

研究人员提出，这种方法可以模拟人类记忆中的**遗忘机制**。通过将对话历史记录渲染成图像进行初步压缩，模型可以通过逐步缩小较旧图像的大小来实现多级压缩。这导致文本逐渐变得模糊，视觉标记数量随之减少，从而实现文本信息的“遗忘”。

这种方法使得模型能够平衡信息保留与计算约束，为开发**理论上无限的上下文架构**提供了新的可能性。

## 5. 核心概念速览 (Flashcards)

以下是模拟读者提问的 Flashcards，帮助您快速回顾 DeepSeek-OCR 的关键知识点。

| 读者提问 (Question) | DeepSeek-OCR 回答 (Answer) | 来源 (Source) |
| :--- | :--- | :--- |
| **Q1:** DeepSeek-OCR 的主要研究目的是什么？ | 主要目的是初步验证通过光学二维映射来压缩长文本语境的可行性。这为解决 LLM 长上下文挑战提供了新方向。 | |
| **Q2:** DeepSeek-OCR 的模型由哪两个主要组件构成？ | DeepSeek-OCR 由 DeepEncoder（负责特征提取、标记化和视觉表示压缩）和 DeepSeek3B-MoE 解码器（负责从压缩标记中重建文本）组成。 | |
| **Q3:** DeepEncoder 如何实现高分辨率下的高效压缩和低激活内存？ | DeepEncoder 串联了由窗口注意力主导的 SAM-base 和由全局注意力主导的 CLIP-large，并在两者之间使用一个 16 倍卷积压缩器来大幅减少视觉标记数量。 | |
| **Q4:** 在压缩性能方面，DeepSeek-OCR 的主要成果是什么？ | 在低于 10 倍的压缩比下，模型可以实现约 97% 的 OCR 解码精度。即使达到 20 倍压缩，精度仍可保持在 60% 左右。 | |
| **Q5:** 什么是“上下文光学压缩”在 LLM 研究中的未来潜力？ | 它有望用于处理多轮对话中超过 K 轮的历史对话记录，以实现 10 倍的压缩效率。通过逐步缩小旧图像，还可以模拟生物学上的记忆遗忘机制。 | |