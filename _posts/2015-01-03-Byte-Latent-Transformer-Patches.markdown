---
layout: post
title: "Byte Latent Transformer: Patches Scale Better Than Tokens — 开创无tokenizer语言建模的新维度"
date: 2025-01-06
reading_time: 30 min
author: Jason Deng
categories: [LLM, papers]
tags: [new, post]
excerpt: “大型语言模型（LLMs）的发展历程传统上由基于tokenizer的架构主导。然而，字节潜在变换器（BLT）的引入标志着一种范式的转变。由Meta的研究人员及其合作伙伴提出，BLT通过消除标记化并处理原始字节数据，创新性地提高了效率和鲁棒性，同时在性能上与tokenizer based model相抗衡。本文将探讨其设计、功能及对未来语言建模的影响。”

---

### 论文信息

<details class="toggle-header">

**Paper URL：** [https://arxiv.org/html/2412.09871v1](https://arxiv.org/html/2412.09871v1)

**Author：** Artidoro Pagnoni Ram Pasunuru Pedro Rodriguez Benjamin Muller Margaret Li Chunting Zhou Lili Yu Jason Weston Luke Zettlemoyer Gargi Ghosh Mike Lewis Ari Holtzman Srinivasan Iyer

**Code：** [https://github.com/facebookresearch/blt](https://github.com/facebookresearch/blt)

**organization：** FAIR at Meta, Paul G. Allen School of Computer Science & Engineering, University of Washington, University of Chicago

\contribution[‡]Joint second author, \contribution[†]Joint last author, \contribution[⋄]Work done at Meta

</details>

---

### 文章目录

<details class="toggle-header">

1 Introduction

2 Patching: From Individual Bytes to Groups of Bytes

2.1 Strided Patching Every K Bytes

2.2 Space Patching

2.3 Entropy Patching: Using Next-Byte Entropies from a Small Byte LM

2.4 The Byte-Pair Encoding (BPE) Tokenizer and Incremental Patching

3 BLT Architecture

3.1 Latent Global Transformer Model

3.2 Local Encoder

3.3 Local Decoder

4 Experimental Setup

4.1 Pre-training Datasets

4.2 Entropy Model

4.3 Entropy Threshold and Equalizing Context Length

4.4 Entropy Model Context

4.5 FLOPs Estimation

4.6 Bits-Per-Byte Estimation

4.7 Transformer Architecture Hyperparameters

4.8 BLT-Specific Hyperparameters

5 Scaling Trends

5.1 Parameter Matched Compute Optimal Scaling Trends

5.2 Beyond Compute Optimal Task Evaluations

5.3 Patches Scale Better Than Tokens

6 Byte Modeling Improves Robustness

6.1 Character-Level Tasks

6.2 Training BLT from Llama 3

7 Ablations and Discussion

8 Related Work

9 Limitations and Future Work

10 Conclusion

</details>

---

### Tokenizer-free的相关研究工作
<details class="toggle-header">

**the key works on tokenizer-free approaches**

| Year  | Model               | Key Features                                                                                     |
| 2022  | ByT5 (Xue et al.)   | - 第一个大规模字节到字节模型，无需 tokenization <br> - 表现出增强的鲁棒性，但需要显著更多的计算资源 <br> - 不使用任何形式的 compression/patching |
| 2022  | CANINE (Clark et al.) | - 无需 tokenization 的预训练编码器，直接处理 character sequences <br> - 通过 strided convolutions 进行下采样以减少 sequence length <br> - 将下采样与 deep transformer stack 相结合 |
| 2023  | MegaByte (Yu et al.) | - 使用固定大小的 byte patches 作为一种 compression 形式 <br> - 将 patched representation 与 byte-level decoder 结合 <br> - 在 1B 规模下展示了与 token models 相竞争的性能 |
| 2024  | MambaByte (Wang et al.) | - 使用 Mamba state space model 架构进行字节级建模 <br> - 使用固定的 memory state 代替 attention <br> - 在增强鲁棒性的同时，表现出与 subword models 相当的性能 |
| 2024  | BLT (Pagnoni et al.) | - 动态的基于 entropy 的字节 patching <br> - 三部分架构：local encoder、global transformer 和 local decoder <br> - 在提升 efficiency 的同时，匹配基于 tokenization 的模型性能 |

这些工作的共同主题包括：

    - 直接处理字节/字符序列，无需tokenization
    
    - 使用各种形式的压缩（固定补丁、下采样、状态空间）来高效处理更长的序列
    
    - 展示了比基于token的模型更强的鲁棒性
    
    - 在保持无标记化优势的同时，努力匹配基于token的模型性能

这一进展表明，在处理字节级建模的计算挑战时，逐步提高了复杂性，同时保留了避免标记化的优势。

</details>

---

### **为什么Tokenize不再占主导地位**

Tokenize一直是大型语言模型（LLMs）的基石，将字节分组为静态标记以便高效处理。然而，这种方法也带来了挑战：

    - 领域和模态敏感性： Tokenize常常引入偏差，影响跨领域的性能。
    
    - 噪声脆弱性： Tokenizer based model对输入噪声敏感。
    
    - 正字法无知： 无法直接访问原始字节级特征，限制了细粒度的语言理解。
    
    - 多语言不公正： 固定的词汇表妨碍了跨语言的公平表示。

BLT通过处理原始字节，并根据熵（数据复杂度的度量）动态地将字节分组为补丁，从而克服了这些局限性。此方法确保了计算资源的高效分配。


---
<details class="toggle-header">

  <p><strong>原文：At scale, the computational cost of a Transformer is dominated by large feed-forward network layers that run on every byte, not the cost of the attention mechanism.</strong></p>

 **问题：** 如何理解？
 
 **回复：**

在解释这个问题之前，先回顾一下标准 Transformer Block 的主要组成部分，以及它们各自的计算流程：
 
- Self-Attention 子层（Multi-Head Attention）
 
- 前馈网络子层（FeedForward Network, FFN）

在分析计算复杂度时，通常我们用以下符号来表示：
 
- L：序列长度（sequence length）。
 
- d：词向量或者隐藏向量的维度（hidden size）。

在典型的 Transformer 结构中，这两部分的主要计算量分别是：
 
- Self-Attention 的计算复杂度： $$O(L^2 \cdot d)$$
 
- 前馈网络（FFN）的计算复杂度： $$O(L \cdot d^2)$$
 
下面分别说明这两个复杂度从哪里来。
 
 ---
 
**1. Self-Attention：$$O(L^2 \cdot d)$$**
 
***1.1 以单头为例的计算分析***
 
 以单头自注意力（Self-Attention）为例，假设输入是一个长度为 L、维度为 d 的序列 $$\mathbf{X}\in \mathbb{R}^{L\times d}$$。通过投影矩阵分别得到 Q, K, V，它们的维度依然是 $$L \times d$$（或者拆分成多头后，每一头的维度是 $$d\_{\text{head}} = d/h$$，但我们这里先以不拆分或等效合并的方式分析）。自注意力机制的主要计算在于：
 
- 计算注意力得分
     
    $$
    \mathbf{A} = \text{softmax}\Big(\frac{Q K^T}{\sqrt{d}}\Big)
    $$
 
- 这里 Q 和 K 的维度都是 $$(L \times d)$$。
 
- $$Q$$ $$K^T$$ 的矩阵乘法会产生一个 $$L \times L$$ 的矩阵，计算量约为 $$O(L \times d \times L) = O(L^2 d)$$。
 
- 乘完之后还要进行一次 softmax 操作，不过相对于 $$L^2 d$$ 的矩阵乘法，softmax 的开销通常记为 $$O(L^2)$$ 或略去常数因子后不影响主项，所以主要复杂度还是来自矩阵乘法。
 
- 将注意力得分与 V 相乘

    $$ 
    \mathbf{O} = \mathbf{A} \cdot V \quad (\text{或类似形式})
    $$
 
 
- $$\mathbf{A} 的维度是 (L \times L)，V 的维度是 (L \times d)$$
 
- 最终得到的结果 $$\mathbf{O} 为 (L \times d)$$
 
- 这里的复杂度同样是 $$O(L \times L \times d) = O(L^2 d)$$

 因此，对自注意力层而言，每个头的主要计算都包含了一个 $$L \times L$$ 级别的操作，再乘上隐藏维度 d。如果是多头注意力（Multi-Head Attention），多头并行时总体来说也维持同量级复杂度，常数倍会是“头数”，因此业界通常引用的复杂度结论是：

   $$
   \boxed{ \text{Self-Attention 复杂度} \approx O(L^2 \cdot d) }
   $$
 
 
**2. 前馈网络（FFN）：$$O(L \cdot d^2)$$**

***2.1 标准 Transformer 中的 FFN 结构***

 在标准的 Transformer 中，前馈网络子层通常是两层全连接网络 $$(Linear/MLP)$$ ，并包含激活函数，比如：
 
   $$
   \text{FFN}(\mathbf{x}) = \max(0, \mathbf{x}\mathbf{W}_1 + \mathbf{b}_1) \mathbf{W}_2 + \mathbf{b}_2
   $$
 
 其中：
 
- $$\mathbf{x}$$ 的维度是 $$(1 \times d)$$，或者如果把批和序列长度都算上就是 $$(L \times d)$$。
 
- $$\mathbf{W}_1 $$的维度是 $$(d \times d_{\text{ff}})$$，通常 $$d_{\text{ff}} \approx 4d$$。
 
- $$\mathbf{W}_2$$ 的维度是 $$(d_{\text{ff}} \times d)$$。
 
 
 
***2.2 计算量来源***
 
- 第一层投影 $$\mathbf{x}\mathbf{W}_1$$
 
- 维度：$$(L \times d) \times (d \times d_{\text{ff}}) \rightarrow (L \times d\_{\text{ff}})$$
 
- 计算复杂度：$$O(L \times d \times d_{\text{ff}})$$。若 $$d_{\text{ff}} \approx 4d$$，则这一项复杂度约为 $$O(4 L d^2)$$，省略常数后为 $$O(L d^2)$$。
 
- 第二层投影与激活 $$\max(0, \cdot) \mathbf{W}_2$$
 
- 维度：$$(L \times d_{\text{ff}}) \times (d_{\text{ff}} \times d) \rightarrow (L \times d)$$
 
- 计算复杂度：$$O(L \times d_{\text{ff}} \times d)$$。同样，若 $$d_{\text{ff}} = 4d$$，则是 $$O(4 L d^2)$$，也是 $$O(L d^2)$$ 的量级。
 
把这两个矩阵乘法相加，依然保持在 $$O(L \cdot d^2)$$ 量级，所以我们常见地将 FFN 子层的计算量写为：
 
   $$
   \boxed{ \text{FFN 复杂度} \approx O(L \cdot d^2) }
   $$
 
 
 **3. 总结**
 
- 自注意力（Self-Attention）中 $$L^2$$ 来自于“所有位置与所有位置”之间的相关性计算，在矩阵乘法和后续的加权过程中，每个 token 都要与长度为 L 的序列进行 dot-product 计算，因此得到 $$O(L^2 \cdot d)$$ 的复杂度。

- 前馈网络（FFN）的 $$d^2$$ 则来自于大维度映射的矩阵乘法。FFN 针对序列中每个位置单独做投影，但投影所用的矩阵往往是 $$(d \times 4d)$$ 和 $$(4d \times d)$$ 的级别，因此每个 token 的计算量是 $$O(d^2)$$，对全序列就是 $$O(L \cdot d^2)$$。

这就是在标准 Transformer 中常见的
 
$$ 
\text{Self-Attention: } O(L^2 d), \quad 
\text{FeedForward Network: } O(L d^2)
$$
的主要原因所在。

</details>

---

### **核心创新： Patches Over Tokens**

![Figure 3: Patching schemes group bytes in different ways, each leading to a different number of resulting patches. Since each patch is processed using a large transformer step, the number of patches directly determines the bulk of the compute expended in terms of flops. These schemes group bytes into patches by (a) striding every four bytes (§2.1) as in MegaByte (Yu et al., 2023), (b) tokenizing with Byte-Pair Encoding (bpe), in this case the Llama-3 (Dubey et al., 2024) tokenizer, (c & d) entropy-based patching as in this work (§2.3), (e) patching on space-bytes (Slagle, 2024), (f) and patching on entropy using a small CNN byte-level model with 2-byte context.](https://arxiv.org/html/2412.09871v1/extracted/6066458/assets/patching_types.png)


BLT将patches作为其主要计算单元，突破了fixed-token词汇表的做法。这些patches通过基于熵的分割生成，动态调整其大小和内容，以适应数据的复杂性。这一创新带来了几个优势：

1. 动态计算分配： 高熵区域得到更多的计算关注，从而优化资源的使用。

2. 可扩展性： BLT通过同时增加补丁和模型的大小，而不增加计算成本，展示了优于基于标记的模型的扩展趋势。

3. 效率提升： 通过将推理成本减少最多50%，BLT在固定的计算预算内支持更大的模型规模。

![https://arxiv.org/html/2412.09871v1/x1.png](https://arxiv.org/html/2412.09871v1/x1.png)

![Figure 1 Scaling trends for fixed inference flop models (fully) trained with varying training budgets. In token-based models, a fixed inference budget determines the model size. In contrast, the BLT architecture provides a new scaling axis allowing simultaneous increases in model and patch size while keeping the same training and inference budget. BLT patch-size (ps) 6 and 8 models quickly overtake scaling trends of bpe Llama 2 and 3. Moving to the larger inference budget makes the larger patch size 8 model more desirable sooner. Both BPE compute-optimal point and crossover point are indicated with vertical lines.](https://arxiv.org/html/2412.09871v1/x2.png)

图示是固定推理计算量时模型的缩放趋势（在不同训练预算下完整训练）。
在基于token的模型中，固定的推理预算决定了模型大小。相比之下，BLT架构提供了一个新的缩放维度，允许在保持相同训练和推理预算的同时同时增加模型和patch大小。

<details class="toggle-header">

 <p><strong>原文：critical difference between patches and tokens is that with tokens, the model has no direct access to the underlying byte features.</strong></p>
 
**问题1:** 这是不是造成经典的9.11>9.8的问题所在？

**回复1.1:** 
 根据文本所述，使用tokens（标记）的模型无法直接访问底层的字节特征，这意味着模型在处理数字序列时缺乏对原始字节级别的理解。这可能导致在处理和比较类似"9.11"和"9.8"这样的数值时出现问题，因为模型只能基于预定义的token来处理，而不能直接理解和处理底层的字节级数值表示。相比之下，BLT模型使用patches直接处理字节序列，可以更好地理解和处理原始数据的特征，这可能有助于更准确地处理数值比较。

**回复1.2:**
根据BLT论文,我认为它可以部分但不能完全解决数字比较这类问题。让我详细分析一下：

1. BLT的优势：
   - 直接在byte级别建模,每个数字会被编码为单独的byte
   - N-gram embedding可以捕获数字序列的模式
   - 相比token-based模型,BLT不会把"9.11"作为单个token处理

2. 依然存在的挑战：
- 数学推理是高层语义问题,仅仅改变token表示并不能完全解决
- 模型仍然需要学习数字的概念和比较运算
- 对小数点的处理可能仍有歧义

3. 可能的改进方向：
- 在数字序列上使用特殊的patch策略
- 为数字比较添加专门的预训练任务
- 结合特定的数字表示方法(如positional encoding)

总的来说，BLT的byte-level处理可能有助于更好地理解数字序列的结构，但要真正解决数学推理问题，还需要在模型架构和训练方法上做进一步的改进。

**问题2:** 基于CoT方式是否相对于BLT更有效解决上述问题？

**回复2:**
如果专门针对数字比较这类问题，我认为基于Chain of Thought (CoT)的微调方式会更有效：

1. CoT的优势：
- 直接引导模型进行step-by-step推理
- 可以显式分解数字比较步骤，如：
  Q: 9.11 > 9.8?   
  A: 让我们一步步分析：   
  - 先比较整数部分：9 = 9   
  - 小数第一位比较：1 < 8   
  - 因此 9.11 < 9.8   答案：否，9.11 < 9.8  
- 可以针对各种数字比较情况设计专门的提示模板

2. BLT的局限：
- 虽然在byte级别有更好的表示
- 但没有直接指导模型如何进行推理
- 需要模型自己学习推理步骤，难度更大

3. 具体实现建议：
- 构建数字比较的专门数据集
- 设计清晰的CoT模板
- 可以结合少量示例的few-shot学习
- 考虑添加自我验证步骤

CoT微调能直接针对问题本质（推理过程），而BLT的改进主要在于表示层面。对于需要明确推理步骤的任务，CoT方法可能更有效。

不过这两种方法也不是互斥的，理想情况下可以将它们结合：
- 使用BLT提供更好的底层表示
- 用CoT微调来增强高层推理能力

<p><strong>原文：A crucial improvement of BLT over tokenization-based models is that redefines the trade off between the vocabulary size and compute. In standard llms, increasing the size of the vocabulary means larger tokens on average and therefore fewer steps for the model but also larger output dimension for the final projection layer of the model. 
</strong></p>

**问题3:** 词表变大代表的FFN层计算复杂度增大，但也同时导致单token容纳的bytes更多?

**回复3:** 
根据文中所述，这确实是一个权衡。在标准的大语言模型中，增大词表会带来两个相反的效果：词表变大会使得每个token平均能包含更多的字节，从而减少模型需要处理的步骤，但同时也会增大最终投影层的输出维度，增加计算开销，正是由于这种权衡的存在，基于分词(tokenization)的方法在调整token大小和推理成本方面的灵活性很有限。比如文中提到，Llama 3相比Llama 2的词表大小增加了4倍，但平均token大小只从3.7字节增加到4.4字节。

**问题4:** BLT能否应用于中文？

**回复4:** 
BLT作为一个基于byte级别的模型应该可以直接应用于中文,但需要注意以下几点:
1. 中文字符的UTF-8编码特点:
   - 每个汉字通常使用3个bytes来编码
   - 会导致序列长度比英文ASCII文本长3倍左右
   - patch size的设置可能需要相应调整以适应这个特点

2. 分组策略的调整:
中文没有空格分词,不能使用whitespace-based patching，可以考虑使用以下几种patching方式:
   - Entropy-based patching: 基于模型预测的条件熵来确定边界
   - Identity patching: 不对序列进行任何预先切分
   - 针对中文优化的patching方法,比如基于字的边界

3. 潜在优势:
   - 可以避免中文分词的问题
   - 能够处理中英混合文本
   - 对罕见字符有更好的泛化能力

4. 需要验证的方面:
   - compression rate在中文上的效果
   - 模型在中文语料上的性能表现
   - 是否需要针对中文特点进行特殊的超参数调整

虽然理论上BLT能处理中文,但目前论文没有在中文数据集上的实验结果。要确定其在中文上的实际效果,还需要进行专门的实验验证。

<p><strong>原文：Thus patching cannot assume access to future bytes in order to choose how to segment the byte sequence. 
Formally, a patching scheme $$f_p$$ satisfies the property of incremental patching if it satisfies:</strong>

$$
f_p(𝒙_{<i})=f_p(𝒙)_{<i}
$$ 

**问题5:** 这个公式如何理解？

**回复5:** 
公式 $$f_p(𝒙_{<i})=f_p(𝒙)_{<i}$$ 是增量分块(incremental patching)的形式化定义。
让我来解释这个公式的含义：
- $$f_p(𝒙_{<i})$$ 表示对序列x的前i个字节进行分块
- $$f_p(𝒙)_{<i}$$ 表示先对整个序列x进行分块，然后只取前i个位置的结果
- 等式表明这两种方式必须得到相同的结果
- 这个公式的实际意义是：当模型在生成文本时，只根据已经看到的字节来决定分块边界的位置，而且这个决定不会因为后面出现的内容而改变。这确保了模型可以在生成过程中实时、稳定地进行分块决策。

</details>

---

### **BLT架构：三模块交响曲**

![Figure 2 BLT comprises three modules, a lightweight Local Encoder that encodes input bytes into patch representations, a computationally expensive Latent Transformer over patch representations, and a lightweight Local Decoder to decode the next patch of bytes. BLT incorporates byte n-gram embeddings and a cross-attention mechanism to maximize information flow between the Latent Transformer and the byte-level modules (Figure 5). Unlike fixed-vocabulary tokenization, BLT dynamically groups bytes into patches preserving access to the byte-level information.](https://arxiv.org/html/2412.09871v1/x3.png)


**BLT的核心由三个互联模块组成：**

  - 本地编码器（Local Encoder）： 使用哈希n-gram嵌入和交叉注意力层对原始字节进行编码，生成补丁表示。

     ![Figure 5 The local encoder uses a cross-attention block with patch representations as queries, and byte representations as keys/values to encode byte representations into patch representations. The local decoder uses a similar block but with the roles reversed i.e. byte representations are now the queries and patch representations are the keys/values. Here we use Cross-Attn k= 2.](https://arxiv.org/html/2412.09871v1/x5.png)

  - 潜在变换器（Latent Transformer）： 处理补丁表示的全局模型，采用块因果注意力机制高效处理上下文依赖。

  - 本地解码器（Local Decoder）： 将补丁表示解码回字节，支持准确的生成和理解。

这种模块化设计确保了字节和补丁信息的无缝集成，既保留了原始数据的丰富性，又优化了计算效率。

<details class="toggle-header">

 <p><strong>原文：This model consumes the bulk of the flops during pre-training as well as inference, and thus, choosing when to invoke it allows us to control and vary the amount of compute expended for different portions of the input and output as a function of input/output complexity.</strong></p>

**问题1:** 这段话如何理解？BLT如何依据输入/输出复杂度来调整对不同输入和输出部分所分配的计算资源？

**回复1:** 

BLT通过动态分配计算资源的设计来实现高效的计算量分配。让我解释一下具体机制：

1. 熵预测驱动的动态分配：
   - BLT使用一个小型字节级语言模型来预测下一个字节的熵 - 当熵值超过设定阈值时，会标记为一个patch的边界 - 熵值高意味着下一个字节预测的不确定性大，需要更多计算资源

2. 具体工作流程：
   - 对于熵值低的部分(如单词末尾的字母)，只使用轻量级的Local Decoder - 当遇到熵值高的部分(如句子开头或生僻词)，才调用计算量大的Latent Global Transformer

3. 实际例子：
   - 预测"computer"这个词时： - "c": 熵值高 → 调用Global Transformer - "omputer": 熵值低 → 只用Local Decoder

4. 优势：
   - 避免对简单预测使用大量计算资源
   - 将计算能力集中在真正需要的复杂预测上
   - 实现了计算资源的自适应分配

5. 效果：
   - 在保持性能的同时降低了50%的推理计算量
   - 特别适合处理长序列输入，因为可以动态跳过简单部分

这种设计让模型能够"智能地"分配计算资源，将大部分计算力用在真正需要的地方，从而提高整体效率。

<p><strong>原文：The transformer layers use a local block causal attention mask; each byte attends to a fixed window of $w_ℰ$ preceding bytes that in general can cross the dynamic patch boundaries but can not cross document boundaries. </strong></p>

**问题2:** byte encoder hidden states是否会作为Latent Global Transformer的输入？

**回复2:** 

byte encoder hidden states不会直接参与到Latent Global Transformer的计算中。让我解释其信息流向：
- 信息流向过程：
    byte encoder hidden states → patch cross attention → patch representations → Latent Global Transformer

- 数据转换： 
    1. byte embeddings转换为hidden states
        - h_init = LocalTransformer(byte_embeddings)
    2. cross attention将hidden states聚合为patch表示
        - h_down = StridedConv(h_init)  
        这里patch representations才会输入Latent Global Transformer
    3. Latent Global Transformer只处理patch级别的表示
        - h_down' = GlobalTransformer(h_down)

- 关键点：
    1. byte encoder hidden states的信息被压缩和聚合到patch representations中
    2. Latent Global Transformer只接收和处理patch level的表示
    3. 原始的byte level信息不会直接参与Global模型的计算

- 这种设计的好处是：
    1. 降低了序列长度，提高计算效率
    2. 保持了层次化的特征表示
    3. 通过cross attention机制保留必要的字节级信息

所以byte encoder hidden states主要作用是帮助构建patch表示，而不是直接参与Latent Global Transformer的计算。

<p><strong>原文：The local decoder predicts a sequence of raw bytes, as a function of previously decoded bytes, and thus, takes as input the hidden representations produced by the local encoder for the byte-sequence.
</strong></p>

**问题3:** local decoder是否使用了local encoder的输出作为输入？

**回复3:** 

本地解码器（local decoder）使用了本地编码器（local encoder）产生的隐藏表示（hidden representations）作为输入。具体来说，解码器在预测原始字节序列时，会利用之前已解码的字节信息，并将编码器生成的隐藏表示作为输入来辅助解码过程。

<p><strong>原文：where once again, $$W_k$$, $$W_v$$ are key/value projection matrices that operate on a linear transformation and split operation $$𝒟_C$$, applied to the final patch representations $$o_j$$ from the global model, $$W_q$$ is a query projection matrices operating on byte representations $$d_{l−1}$$ from the previous decoder transformer layer (or $$h_{l_ℰ}$$ for the first layer), and $W_o$ is the output projection matrix, thus making $$B∈ℝ^{h_𝒟×n_b}$$, where $n_b$ is the number of output bytes.</strong></p>

**问题4:** split operation $$𝒟_C$$ 具体是如何实现的？

**回复4:** 
从代码中看到split实际上是通过reshape实现的，以下详细分析一下具体实现：

在LocalDecoder类中：

    def forward(self, tokens, embeds, patch_embeds, ...):
        # ...
        if self.patch_embedding_projection is not None:
            # 1. 首先通过线性投影
            patch_embeds = self.patch_embedding_projection(patch_embeds)
            
            # 2. 如果存在cross_attn_k,进行reshape操作
            if self.cross_attn_k is not None:
                # 这里实现了split操作
                patch_embeds = patch_embeds.reshape(
                    bs,  # batch_size 
                    patch_embeds.shape[1] * self.cross_attn_k,  
                    # 新的序列长度
                    self.dim  # 每个head的维度
                )

让我解释这个reshape操作的细节：

1. patch_embedding_projection的作用：

        def _create_patch_projection(self, args):
            if not self._should_create_patch_projection(args):
                return None
            
            # 输出维度是token_emb_dim乘以cross_attn_k
            output_dim = args.dim_token_emb * (self.cross_attn_k or 1)
            
            return nn.Linear(
                in_features=args.dim_patch_emb,
                out_features=output_dim,
                bias=False,
            )

2. reshape的过程：
   - 输入形状: [batch_size, seq_len, dim_patch_emb]
   - 线性投影后: [batch_size, seq_len, dim_token_emb * cross_attn_k]
   - reshape后: [batch_size, seq_len * cross_attn_k, dim_token_emb]

这表明：
  - split不是通过切分或平均操作实现的
  - 而是先通过线性投影扩展维度
  - 然后通过reshape重排这些维度
  - cross_attn_k决定了要分成多少个head

这种实现方式的优点是：
  - 保持了数据的连续性
  - 避免了显式的切分操作
  - 让每个head能够学习到不同的特征表示
  - 计算效率更高

这与论文描述的"maintain P_l as multiple heads"是一致的，只是实现方式更加优雅和高效。

**问题5:** 这里线性投影，为什么不直接投影到reshape后的维度呢？而需要再进行一次reshape?？

**回复5:** 

这是一个常见的实现模式：
先用线性层将 [batch, seq_len, dim\_patch\_emb] 投影到 [batch, seq_len, (cross\_attn\_k * dim\_token\_emb)]的“扁平”形状，然后再用 reshape/view 对最后一维进行拆分或合并，从而得到想要的[batch, seq_len * cross\_attn\_k, dim\_token\_emb] 或 [batch, seq_len, cross\_attn\_k, dim\_token\_emb] 等多维结构。
这样做最主要是为了遵循 线性层的标准输入/输出格式 以及 在后续阶段灵活地处理拆分和并行维度（比如多头、多分块）。
在 PyTorch 中，一个 nn.Linear(in_features, out_features) 通常只对最后一维做线性变换，后续如果要进一步拆分或合并，需要显式地做一个 reshape。

**详细解析**

在这段代码里，核心流程是：

1.	线性投影（nn.Linear）：
   - 将输入从 [batch_size, patch_seq_len, dim\_patch\_emb] 形状，投影成 [batch_size, patch_seq_len, cross\_attn\_k * dim\_token\_emb] 。
   - 代码里 out_features = dim_token_emb * cross_attn_k。

2.	reshape 操作：
   - 把投影后的最后一维 “拆分”/“折叠”成新的序列长度和新特征维度：

   [batch, patch_seq_len, (cross\_attn\_k * dim\_token\_emb)]
$$
\;\;\longrightarrow\;\;
$$
   [batch, (patch\_seq\_len * cross\_attn\_k), dim\_token\_emb]

   - 或者在其他情况下，也可以 reshape 成

   [batch, patch\_seq\_len, cross\_attn\_k, dim\_token\_emb]

等等，不同项目中可能有不同的拆分方式。


之所以 不直接 在线性层中就输出三维甚至四维的形状，而是先输出 
[…, cross\_attn\_k * dim\_token\_emb] 
再 reshape，背后有以下常见原因：

1. PyTorch 中 nn.Linear 的“常规做法”
    PyTorch (乃至大多数深度学习框架) 中的 nn.Linear(in_features, out_features)，其输入一般是 [batch\_dims, seq\_len, in\_features]，然后将最后一维 in_features 投影到 out_features，输出形状是 [batch\_dims, seq\_len, out\_features]。
    如果要获得更高维度的输出（例如 [..., cross_attn_k, dim_token_emb]），往往需要显式地在算完线性层以后进行 reshape。
	
2.	实现简单，可读性和维护性更好
	•	先将最后一维统一投影到 out\_features = cross\_attn\_k \times dim\_token\_emb ，再在后面单点地 reshape，实现逻辑更直观。
	•	如果后续要改动拆分方式（例如多头、多分块），只需要改动后面一个 reshape 的逻辑即可，而不必改动 nn.Linear 的初始化。

3. 在多头、多路分块时的“通用套路”
	•	很多多头机制（multi-head attention）或多分块（multi-group）都会先把 hidden\_dim 线性投影到 (num_heads * head_dim)，再用 reshape/view/transpose 将序列维度或头的维度拆出来。
	•	这是个极其常见的模式，目的是在矩阵乘法中维持一个干净且通用的「二维/三维输入输出」逻辑，后面再用 reshape 来做灵活的维度处理。

4.	避免写“自定义”线性层
    •	如果想要一次性输出 [batch, seq\_len * cross\_attn\_k, dim\_token\_emb] 那可能就需要自己写一个带有自定义 broadcast/reshape 的 Linear，会让代码更复杂、可读性更差。
    •	在实际工程中，先 nn.Linear(in_features, out_features)，然后做 view/reshape 几乎是约定俗成的做法。

类比：多头注意力的拆分

一个和这里非常类似的常见场景是 多头自注意力 (Multi-Head Self-Attention)：

1.	我们通常先用 nn.Linear(hidden_dim, num_heads * head_dim)
2.	再 reshape 成 [batch, seq\_len, num\_heads, head\_dim]
3.	最终再 transpose 一下得到 [batch, num\_heads, seq\_len, head\_dim]


它的思想和你看到的这段 BLT patch_embeds 代码是一样的：
	•	先将倒数第二个维度投影到一个扁平的 num_heads * head_dim，
	•	再 reshape 分拆出 num_heads 这个新维度。


在 Byte/patch 级别的 cross-attn、分块、或 multi-group 等场景下，也是一模一样的套路。

小结 :“先线性投影，再 reshape” 是 PyTorch 等框架里主流的、惯用的实现方式，也是使代码更通用和易维护的常见实践。


简而言之，nn.Linear() 只管把维度从 […, in\_features] 投影到 […, out\_features]，把更多维度或时序长度的处理逻辑留给了后续的 reshape/view/transpose，因此它先输出一个“扁平”的维度，再去做拆分、合并或广播，就能非常灵活地适配多头、多分块、以及各种不同下游模块的需求。

</details>

---
### 实验设置总结

实验设置包括预训练数据集的选择、熵模型的训练、patching策略的优化以及FLOPs的计算方法。通过这些设置，确保实验结果的可比性和可靠性。

以下是实验设置的精华总结：

#### 1. **预训练数据集**
   - **Llama 2 数据集**：包含2万亿个token，用于扩展定律实验，确定BLT的最佳架构选择。
   - **BLT-1T 数据集**：包含1万亿个token，用于与Llama 3进行下游任务对比的完整预训练。
   - **数据来源**：所有数据均来自公开来源，确保实验的透明性和可重复性。

#### 2. **熵模型**
   - **模型架构**：使用100M参数的字节级语言模型，基于Transformer架构，滑动窗口注意力为512字节。
   - **动态patching**：通过熵模型预测下一字节的不确定性，动态调整patch大小，确保计算资源的高效分配。

#### 3. **熵阈值与上下文长度**
   - **动态调整**：根据熵阈值动态调整patch大小，确保在数据复杂度高的区域分配更多计算资源。
   - **上下文长度均衡**：通过调整序列长度，确保不同patch大小的模型在相同的字节批次上进行训练，避免不公平的比较。

#### 4. **FLOPs计算**
   - **计算方法**：基于Chinchilla的Transformer FLOPs计算方程，结合局部编码器、全局Transformer和局部解码器的FLOPs。
   - **输入嵌入优化**：假设输入嵌入层为高效查找操作，减少计算开销。

#### 5. **每字节比特数（BPB）**
   - **替代困惑度**：BPB作为tokenizer独立的性能指标，用于比较字节级模型和token-based模型的表现。

#### 6. **Transformer架构超参数**
   - **架构一致性**：BLT的局部和全局Transformer均遵循Llama 3的架构，使用SwiGLU激活函数、旋转位置嵌入（RoPE）和RMSNorm层归一化。
   - **注意力机制**：使用Flash Attention优化自注意力层，Flex Attention优化交叉注意力层，提升训练效率。

#### 7. **BLT特定超参数**
   - **模型规模**：实验涵盖400M到8B参数的模型，验证BLT在不同规模下的扩展性。
   - **优化设置**：使用AdamW优化器，学习率为4e-4，结合线性预热和余弦衰减调度，确保训练稳定性。

#### 8. **实验目标**
   - **性能对比**：与Llama 3等token-based模型进行对比，验证BLT在相同计算预算下的性能优势。
   - **鲁棒性验证**：通过噪声输入和字符级任务，验证BLT在处理复杂数据时的鲁棒性。
   - **扩展性验证**：通过不同patch大小和模型规模的实验，验证BLT在扩展性上的优势。

#### 总结
BLT的实验设置通过精心设计的数据集、动态patching策略和高效的FLOPs计算，验证了其在性能、效率和鲁棒性上的优势。实验结果表明，BLT不仅能够匹配token-based模型的性能，还在推理效率和扩展性上展现出显著优势，为未来语言建模提供了新的方向。


<details class="toggle-header">

<p><strong>原文：We carefully design controlled experiments to compare BLT with tokenization based models with particular attention to not give BLT any advantages from possibly using longer sequence contexts.
</strong></p>

**问题1:** 为什么要控制sequence length?这个对试验有什么影响？？

**回复1:** 

在原文中，作者多次强调要保证 BLT 和基于 token 的模型在实验中“看到”或处理到的序列（文本）长度大体一致，即“不让 BLT 因为能处理更长上下文而额外获利”。这一点之所以重要，主要基于以下考虑：

1. Byte 级模型与 Token 级模型天然序列长度不同

	•	对于传统的基于 subword token 的模型（如 BPE），一个 token 平均可能对应 3~4 个字节；

	•	而在 BLT 中，最原始的输入是按字节（byte）级输入，如果不加控制，Byte 模型在同样的“步骤”（或同样的 batch size）下就有可能看到更多实际字符，从而获得“额外的信息量”或“更长的上下文”。

	•	因此，如果让 Byte 模型直接处理比 BPE 模型更多的原始字节数，很可能会造成实验对比不公平，难以判断性能提升究竟来自架构改进还是来自可访问的上下文变长。

2. 序列长度会影响模型的计算量与性能

    •	如果 BLT 的每次训练或推理都能“看到”比 BPE 模型更长的实际文本序列，那么有可能带来更好的语言建模效果，但这并非纯粹由 BLT 的“动态分组/patching”设计带来的优势，而是因为额外的上下文信息。

    •	另一方面，序列长度也与计算成本（FLOPs）强相关：序列越长，需要的 self-attention 或 feed-forward 计算步数就越多。倘若 BLT 不限制序列长度，而 BPE 的序列长度被限制，那 BLT 就在算力/成本与数据使用上都存在“不对等”条件。

3. 控制变量以排除干扰因素，突出模型本身的对比

    •	做对比实验时，通常会采用“控制变量法”去尽量排除所有无关因素（如上下文长度、能看到的字符数等），从而把焦点集中在 BLT 的“可动态分组”以及“字节级建模”本身的效果上。

    •	一旦让 BLT “看到”更多的字节，无法明确区分是因为见到更多文本造成的收益，还是确实来自架构改进（例如 local encoder、n-gram hash embeddings、cross-attention、dynamic patching 等）的收益。

综上所述，之所以在论文中严格控制或对齐 Byte 模型与基于 Token 的模型的输入序列长度，是为了让二者在“同样的文本长度”或“同样的可访问信息”条件下进行对比，从而更准确地评估 BLT 架构本身（如动态 patching、Local Encoder/Decoder 等）的改进带来的收益，而不是被额外的可见文本长度所“稀释”或“放大”。
在实验设计上，这会影响到：

- 训练和推理的 batch size 设定：需要确保 Byte 模型和 Token 模型在相同 batch 情况下，处理到的实际字节数或文本规模是等价的。
- 上下文窗口大小的选择：Byte 模型因为是字节级，默认会比 Token 模型有更长的潜在序列，如果不控制，Byte 模型每个样本可能看到更多上下文。
- FLOPs（浮点运算量）或内存占用：较长序列的注意力计算更贵，控制序列长度可以让比较变得更公平。

只有在这样“被控制”的场景下，才能凸显 BLT 在同等条件下与 BPE 类模型的真实差异，并做出更客观的结论。

**问题2:** 对于“Byte 模型因为是字节级，默认会比 Token 模型有更长的潜在序列”的理解，意思是：相同的一句话，转换为tokens的序列长度比基于BLT模型转换的字节序列要短，是吗？

**回复2:** 

是的，通常情况下，如果我们把同一句话分别用
- 字节级（Byte-level） 的方式表示
- BPE/词片（Token-based） 的方式表示

那么字节序列通常会更长（因为每个字符都要用一个或多个字节来表示），而 BPE 模型则会把多个字符合并成一个 token，因此得到的序列会更短。

举个简单例子： “Hello world”

- 以英文 ASCII 字节方式表示：H e l l o  w o r l d（共 11 个字符，包括空格），实际上还要算上结尾符号、换行、特殊标记等，往往字节数会更多。
- 经过 BPE 可能只会得到 2~3 个 token（比如 [Hello]\ [_world]），因此序列长度较短。


这也是为什么在不加控制的情况下，Byte-level 模型会“看到”更长的序列：同样的文本，字节序列天然地比 BPE 序列更长。为了做公平的对比，论文中往往会控制或对齐二者“实际处理到的文本长度”或“处理到的字节总数”，避免让 Byte-level 模型因为处理了更多原始字节而额外获利。

**问题3:** 文章中是控制基于相同字节的context length对BLT与token based model进行对比试验的吗？

**回复3:** 
是的，他们主要是按“字节（bytes）总数”来控制上下文的长度，从而保证在同一次训练或推理中，BLT 和基于 Token 的模型在“能看到的原始字节总量”上是一致的。这样就避免了 BLT 因为默认字节序列更长而“额外获利”的问题。

具体来说，论文中提到的做法大致包含以下要点：

1.	固定每个批次(batch)的字节总数:
    例如，在处理 Llama 2 数据集时，作者让每个序列的平均长度为 8k 字节；在处理 BLT-1T 数据集时，他们让每个序列的平均长度为 16k 字节。 
    如此一来，无论是 BPE 模型还是 BLT，在同一个 batch 中，都只能“看到”大约相同数量的原始字节。

2.  对应地调整 BPE 模型的序列长度:
    对于 BPE/token 模型，如果一行文本有 8k 字节，Token 化以后可能只有几千个 token（甚至更少），但总的“原始字节数”仍然控制在 8k。
    BLT 则直接处理 8k 字节的序列（再进一步分成 dynamic patch），两边在字节量上是对齐的。

3.	避免让 BLT “看到”比 BPE 模型更多的实际信息:
    若不控制，BLT 可能会直接拿到更多的上下文（因为它按字节读入），而 BPE 模型在同样的文本下往往只对应更短的 token 序列。
    通过固定“字节总数”的做法，可以排除“谁看了更多文本”这个因素，把实验对比的重点放在了「按字节 vs. 按 token」以及「动态分组 vs. 固定分词」本身的差异上。

4.	Flops（计算成本）和上下文长度也因此得到可对齐的衡量:
    作者还进一步做了推理/训练 Flops 的精细估算，并在同等“可见字节数”或同等训练预算时比较性能，保证了对比的公平性。


因此，文中所谓的“carefully design controlled experiments”就是在保证同等字节上下文及相同训练/推理 FLOPs 预算的情况下，对 BLT 与基于 token 的模型进行一系列实验，以排除序列长度或数据规模不同带来的干扰，让读者能更好地理解 BLT 架构本身的优劣势。

</details>

---

### **Key Findings and Contributions**



BLT的贡献重新定义了LLM的范式：

- Flop Efficiency（浮点操作效率）： 在训练性能上匹配了如LLaMA 3等基于tokenized的模型，同时显著降低了推理成本。

- Robustness（鲁棒性）： 展示了对噪声输入的强大抵抗能力和增强的字符级理解能力，在正字法知识和低资源机器翻译任务中表现卓越。

- Scaling Potential（扩展潜力）： 解锁了LLM扩展的新维度，允许补丁和模型尺寸的同时增长。

---

### **Empirical Insights: BLT in Action**

BLT's superiority is evident in its performance on standard benchmarks and specific tasks. For instance:

- **Noise Robustness:** Outperforms token-based models in handling noisy inputs, such as character-level distortions.
- **Orthographic Tasks:** Excels in character manipulation tasks, leveraging direct byte-level access.
- **Translation:** Achieves higher scores in low-resource language translations, demonstrating its adaptability to diverse linguistic contexts.

---

### **Beyond Tokenization: The Road Ahead**

The introduction of BLT signals a transformative era in LLM development. By prioritizing efficiency, robustness, and scalability, it paves the way for more inclusive, adaptable, and powerful language models. Researchers and developers can access BLT’s training and inference code on [GitHub](https://github.com/facebookresearch/blt).

For correspondence or collaboration inquiries, contact Artidoro Pagnoni or Srinivasan Iyer via the provided emails.

---

**Conclusion**
BLT is more than an architecture; it is a statement against the limitations of traditional tokenization. By redefining how LLMs process language, it lays the groundwork for future innovations that prioritize flexibility, efficiency, and fairness in AI-driven communication. The age of byte-level language modeling has truly begun.
BLT不仅仅是一种架构；这是对传统标记化（Tokenize）局限性的一种声明。通过重新定义LLM自然语言处理语言的方式，它为未来的创新奠定了基础，在人工智能驱动的交流中，优先考虑灵活性、效率和公平性。字节级语言建模的时代已经真正开始。