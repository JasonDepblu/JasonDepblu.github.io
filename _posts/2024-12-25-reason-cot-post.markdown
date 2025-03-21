---
layout: post
title: "Coconut：在连续潜在空间中的大语言模型推理范式研究"
date: 2024-12-25
reading_time: "15 min"
author: "Jason Deng"
categories: [LLM, papers]
tags: [reason, CoT]
image: ../assets/images/post1.png
excerpt: "本文基于新兴范式 Coconut（连续思维链）的引入，深入探讨了大语言模型(LLMs)中思维链(Chain-of-Thought, CoT)推理和潜在推理的分类，这些分类在思维图谱框架中得到了概述。本文旨在总结大语言模型推理领域的发展轨迹和核心挑战。"
---

**Author:** Shibo Hao, Sainbayar Sukhbaatar, DiJia Su, Xian Li, Zhiting Hu, Jason Weston, Yuandong Tian  
1. FAIR at Meta  
2. UC San Diego  
∗ Work done at Meta  

**URL:** [https://arxiv.org/html/2412.06769v2](https://arxiv.org/html/2412.06769v2)  
**Title:** *Training Large Language Models to Reason in a Continuous Latent Space*

---

## 一、思维链(CoT)推理：系统性综述

### 1. 方法分类

#### 1.1 提示工程

- **Jason Wei 等 (2022)：“Chain-of-thought prompting elicits reasoning in large language models.”**  
  通过设计思维链提示来引导大语言模型提供完整的推理路径，然后再生成最终答案，在复杂任务中显著提升了性能。

- **Tushar Khot 等 (2022)：“Decomposed prompting: A modular approach for solving complex tasks.”**  
  提出分解提示法，将复杂问题分解为多个子问题，逐步求解。

- **Denny Zhou 等 (2022)：“Least-to-most prompting enables complex reasoning in large language models.”**  
  开发了由简至繁提示法，首先生成子问题，然后按序求解，以捕捉更深层的依赖关系。

#### 1.2 监督式微调

- **Xiang Yue 等 (2023)：“Mammoth: Building math generalist models through hybrid instruction tuning.”**  
  在 Mammoth 项目中引入混合指令调优，提升了数学推理的泛化能力和鲁棒性。

- **Longhui Yu 等 (2023)：“Metamath: Bootstrap your own mathematical questions for large language models.”**  
  Metamath 项目利用众包或自生成数据进行监督式微调，在数学任务中实现了更强的泛化能力。

#### 1.3 强化学习

- **Alex Havrilla 等 (2024)：“Teaching large language models to reason with reinforcement learning.”**  
  开创性地将强化学习应用于教授大语言模型 CoT 推理。

- **Shibo Hao 等 (2024)：“Reasoning with language model is planning with world model.”**  
  将推理视为结合世界模型的规划过程，增强了动态情境推理能力。

- **Zhihong Shao 等 (2024)：“Deepseekmath: Pushing the limits of mathematical reasoning in open language models.”**  
  DeepSeekMath 应用强化学习来克服高难度数学场景的局限性。

#### 1.4 Token 分析

- **Aman Madaan 和 Amir Yazdanbakhsh (2022)：“Text and patterns: For effective chain of thought, it takes two to tango.”**  
  研究了“符号”、“模式”和“文本” token 在引导高效简洁的 CoT 生成中的作用。

#### 1.5 理论分析

- **Guhao Feng 等 (2023)：“Towards revealing the mystery behind chain of thought: A theoretical perspective.”**  
  从理论角度阐述了 CoT 如何增强模型的表达能力和深度。

- **William Merrill 和 Ashish Sabharwal (2023)：“The expressive power of transformers with chain of thought.”**  
  研究了引入 CoT 的 Transformer 的扩展表征能力。

- **Zhiyuan Li 等 (2024)：“Chain of thought empowers transformers to solve inherently serial problems.”**  
  证明 CoT 帮助 Transformer 解决本质上的顺序性任务，使模型能够“深化”并逐步推理。

### 2. 关键挑战与改进方向

#### 2.1 规划与搜索问题

- **Yann LeCun (2022)：“A path towards autonomous machine intelligence version 0.9.2.”**  
  探讨了“单路径自回归生成”在复杂任务中的局限性。

- **Yuxi Xie 等 (2023)：“Self-evaluation guided beam search for reasoning.”**  
  引入自评估引导集束搜索，使模型能在搜索过程中自我评估不同分支的质量，提高推理准确性。

- **Shunyu Yao 等 (2023)：“Tree of thoughts: Deliberate problem solving with large language models.”**  
  提出思维树 (Tree-of-Thoughts, ToT)，通过树搜索过程显式探索和重访多个推理分支。

---

## 二、大语言模型中的潜在推理：隐式推理的新视角

### 1. 定义和核心现象

#### 1.1 隐藏计算研究

- **Sohee Yang 等 (2024)：“Do large language models latently perform multi-hop reasoning?”**  
  研究大语言模型是否在多跳推理任务中隐式编码中间步骤。

- **Eden Biran 等 (2024)：“Hopping too late: Exploring the limitations of large language models on multi-hop queries.”**  
  探讨多跳推理中“延迟决策”带来的局限性。

- **Yuval Shalev 等 (2024)：“Distributional reasoning in llms: Parallel reasoning processes in multi-hop reasoning.”**  
  在多跳任务中发现了隐式并行推理过程的证据。

#### 1.2 CoT 中的“不一致性”

- **Boshi Wang 等 (2022)：“Towards understanding chain-of-thought prompting: An empirical study of what matters.”**  
  实证研究揭示模型生成的“链条”常常偏离实际内部计算，暴露出“表层-深层不匹配”现象。

- **Miles Turpin 等 (2024)： “Language models don’t always say what they think: Unfaithful explanations in chain-of-thought.”**  
  强调了显式解释与真实推理路径之间的差异，引发了对安全性和可信度的思考。

### 2. 增强潜在推理

#### 2.1 额外 Token 扩展

- **Sachin Goyal 等 (2023)：“Think before you speak: Training language models with pause tokens.”**  
  主张使用 `<pause>` 等特殊 token 来鼓励模型“思考后回应”，提升推理表现。

- **Jacob Pfau 等 (2024)：“Let’s think dot by dot: Hidden computation in transformer language models.”**  
  发现在部分并行任务中插入“...”等填充 token 能带来性能提升。

#### 2.2 规划 Token 预测

- **Xinyi Wang 等 (2023)：“Guiding language model reasoning with planning tokens.”**  
  用规划 token 引导模型生成更有结构的推理链。

#### 2.3 知识蒸馏

- **Yuntian Deng 等 (2023 & 2024)：“Implicit chain of thought reasoning via knowledge distillation.” & “From explicit cot to implicit cot: Learning to internalize cot step by step.”**  
  提出 iCoT（隐式思维链），通过知识蒸馏压缩推理步骤，在不需要显式输出的情况下内化 CoT。

- **Ping Yu 等 (2024)：“Distilling system 2 into system 1.”**  
  将显式的“系统 2”推理蒸馏为“系统 1”内部表征，降低推理成本。

### 3. 方法扩展与优化

- **循环 Transformer：**  
  - **Angeliki Giannou 等 (2023) 和 Ying Fan 等 (2024)：“Looped transformers as programmable computers.” & “Looped transformers for length generalization.”**  
    引入循环 Transformer 用于迭代自处理，支持算法任务和长度泛化。这与 Coconut 的状态反馈“递归”推理机制相呼应。

---

## 三、与 Coconut 的整合：连接显式和潜在推理

根据选定研究，神经影像学实验表明：在人类执行各类推理任务时，主要负责语言理解和生成的大脑语言网络区域往往并不高度活跃。基于 Coconut（连续思维链）的方法，不仅可以部分映射这种认知现象，也在推理效率上有显著优势。Coconut 通过在连续潜在空间中进行推理，而非依赖传统在自然语言空间中逐步生成推理步骤的思维链方法，引入了一个新的推理范式。

具体来说，Coconut 利用语言模型的最终隐藏状态作为“连续思维”的表征，直接将其作为后续步骤的输入，而不是将其解码为 token。主要变化和优势包括：

![Comparison]( {{ "/assets/images/Figure 1 A comparison of Chain of Continuous Thought (Coconut) with Chain-of-Thought (CoT).png" | relative_url }})  
*Figure 1: A comparison of Chain of Continuous Thought (Coconut) with Chain-of-Thought (CoT).*

### 推理空间的转变
- **传统 CoT：**  
  依赖自然语言逐步生成推理，在复杂任务中容易导致效率低下和表达限制。  
- **Coconut：**  
  在潜在空间中运作，更灵活高效，不受语言约束。

### 增强的推理能力
- **多路径推理：**  
  在连续思维中可同时编码多个潜在的下一步，提升需要广泛搜索和回溯的任务表现。  
- **降低错误传播：**  
  避免每步显式语言输出，在潜在空间中优化推理路径，减少错误的累积。

### 效率提升
- **减少 Token 生成：**  
  以更少的步骤完成任务，显著减少 Token 生成量。  
- **潜在空间优化：**  
  直接使用隐藏状态进行推理，降低解码和编码开销。

### 训练与优化
- **多阶段训练：**  
  逐步将显式 CoT 转化为连续思维，提高推理能力与训练效率。

在多个推理任务（尤其是需要复杂规划和搜索的 ProsQA 等场景）中，Coconut 相比传统 CoT 展现出更高的准确率和更少的 Token 生成量。

相关研究佐证：

- **Amalric 和 Dehaene (2019)：**  
  研究非语言区域在逻辑推理任务中的作用。  
- **Monti 等 (2007, 2009, 2012)：**  
  多项研究强调语言处理与推理的解离。  
- **Fedorenko 等 (2011)：**  
  研究发现语言区域在推理过程中的参与度有限，提示了特定领域网络的重要性。

---

## 四、Coconut 的关键特性与机制

### 1. 从“显式生成”到“隐式思考”

与 CoT 的自回归显式搜索（如 ToT）不同，Coconut 能在连续潜在空间中并行保留多个候选路径，与递归推理和内化策略相匹配。它的训练细节进一步凸显了其独特方法：

![Comparison]( {{ "/assets/images/Figure 2 Training procedure of Chain of Continuous Thought (Coconut).png" | relative_url }})  
*Figure 2: Training procedure of Chain of Continuous Thought (Coconut).*

1. **可微分性与反向传播**  
   Coconut 的连续思维完全面向可微分，支持通过反向传播进行优化，学习更高效的连续推理表征。

2. **前向传递**  
   若当前训练阶段设置了 \(n\) 个潜在思维，需执行 \(n+1\) 次前向传递。每次生成新的潜在思维，最后一次传递用于处理剩余文本序列。

3. **损失计算**  
   在每次传递里生成新的潜在思维；最后一次前向传递处理任务输出并计算损失。

4. **顺序与并行化挑战**  
   KV 缓存可减轻部分重复计算，但因为每次传递依赖前一次结果，无法完全并行化。

5. **未来优化方向**  
   提升训练效率仍是研究重点，力求在不损害推理能力的前提下降低计算资源需求。

### 2. 连接“表层语言”和“潜在推理”

Coconut 减少了对自然语言形式生成的依赖，避免了显式 CoT 输出中常见的不一致性。

### 3. 重新思考“规划与搜索”

Coconut 的连续推理过程可被类比为“搜索树”而非线性推理链。它可在潜在空间中保留并评价多条分支，同时基于搜索价值动态调度：

1. **连续思维与搜索树类比**  
   - 在搜索树中，每个节点代表一个潜在推理状态，分支代表可能的发展路径。  
   - Coconut 可同时对多个路径并行评分并进行剪枝。

2. **示例（图 7）**  
   若根节点为 Alex，第一步可探索 `{lempus, sterpus, zhorpus, grimpus}`；若选择 `lempus` 分支，下一步则从孙节点展开。Coconut 能自动评估哪些分支更有前景。

![Trees]( {{ "/assets/images/Figure 7 An illustration of the latent search trees.png " | relative_url }}) 
*Figure 7 An illustration of the latent search trees.*

3. **与标准 BFS 的区别**  
   - **BFS：** 统一广度探索前沿节点。  
   - **Coconut：** 动态优先级评估，在潜在空间评估每个分支的“价值”，更灵活高效。

4. **语言空间解码**  
   经过连续思维后，若返回语言空间，模型会解码出可能的推理路径。根据概率分布，可进一步分析其偏好及下一步选择。

**总结：**  
Coconut 的优势在于隐式评估与动态调度，使其在需要广泛搜索与规划的复杂任务中具备更高效的推理能力。

### 4. 与多阶段训练和自监督的协同效应

1. **多阶段训练与分解目标**  
   - 通过多阶段课程将训练目标分解并逐步复杂化，Coconut 在复杂推理任务中表现更佳。  
   - `<pause>` token 也可结合类似思路在部分场景中获得增益。

2. **与 iCoT 的比较**  
   - iCoT（隐式思维链）也使用多阶段训练，但在“计划移除”等细粒度操作上有所差异。  
   - 二者方法或可结合，进一步强化模型在潜在空间的推理能力。

3. **对监督信号的依赖**  
   - 目前 Coconut 训练时依赖显式思维链数据，将其转化为潜在推理目标。  
   - 作者提出未来可探索不依赖显式语言链监督的潜在推理策略，使模型更具通用性。

#### 混合数据策略

在 Coconut 的多阶段训练中，以 \(p = 0.3\) 的概率将早期阶段数据混入当前训练阶段，有效防止模型遗忘之前学到的知识：

- **连续思维插入**  
  中间阶段的隐层表征（连续嵌入或“思维”）以一定概率被混入后续训练目标中，保证连续性和统一性。

- **目标选择**  
  这些隐层数据能作为额外监督信号，帮助模型在潜在空间和语言空间间更好地衔接。

- **防止遗忘**  
  混合数据策略可最大程度保留早期训练内容，避免在后续阶段产生“灾难性遗忘”。

实验显示，该方法能在多阶段复杂推理任务中取得良好平衡，在潜在（隐层）与显式（文本）推理间自由切换。

![Comparison]( {{ "/assets/images/Table1_Results_on_three_datasets(GSM8l_ProntoQA_ProsQA).png" | relative_url }})  
*Table 1: Results on three datasets (GSM8l, ProntoQA, ProsQA).*

---

## 五、展望：未来推理框架中的多范式集成

### 1. 跨范式融合

将 `<pause>` token、规划 token 与 Coconut 结合使用，可兼顾显式可解释性与隐式并行性，适配更复杂的推理任务。

### 2. 自动化搜索与人工干预

将 Coconut 的潜在空间推理嵌入到 ToT 框架中可有效提升搜索效率与准确性，也为人工干预保留了接口。

### 3. 通用预训练重新设计

若在基础模型（如循环 Transformer）中融入“递归”或“连续推理”机制，可能在推理能力上带来跨越式提升。

---

## 六、结论

本文通过回顾思维链（CoT）在提示工程、监督式微调、强化学习与理论分析等方面的最新发展，说明了显式推理链在诸多任务中的优势与不足。潜在推理的出现进一步挖掘了内化多跳推理与规划的潜力。

Coconut 将这两者加以整合，通过多阶段训练与潜在状态反馈，在连续空间中完成推理和规划，不再局限于单一路径的自回归生成方式。在大量需要规划、回溯的复杂任务中，Coconut 展现了突出的灵活性与效率。

未来，Coconut、iCoT、`<pause>` token 与循环 Transformer 等技术有望通过更大规模、更多样化的验证不断进化，逐渐弥合“语言空间推理”与“内部模型推理”之间的鸿沟，向真正的灵活、多路径的自主思考推进。