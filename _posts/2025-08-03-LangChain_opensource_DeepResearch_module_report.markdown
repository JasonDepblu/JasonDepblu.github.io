---
layout: post
title: "LangChain 开源 Deep Research 模块深度调研报告"
date: 2025-08-03
reading_time: 15 min
author: Jason Deng
categories: [agent, application, langchain]
tags: [deepresearch, langchain]
excerpt: “提出了一种新的生成式过程奖励模型GenPRM，通过链式推理和代码验证提升了过程监督能力，显著超越传统模型，并在数学推理任务中表现突出，展示了生成推理与测试时计算扩展的有效结合。未来可探索其在编程任务中的应用。”

---

# 目录

 1.	引言
 2.	LangChain Deep Research 模块综述
 3.	主流 Deep Research 产品对比
 4.	LangChain 劣势与源码解析
 5.	结论与展望
 6.	参考文献


## 引言

"Deep Research"（深度研究）已成为大模型代理应用的新热点。不同于传统搜索仅返回结果列表，
深度研究代理能够自主检索多源信息并产出长篇、引注明确的综合报告。
OpenAI 在 2025 年推出了 Deep Research 工作流，引发开源社区的响应：
LangChain 开源了 Deep Research 模块（Open Deep Research），并有 HuggingFace、Camel 等推出类似方案。
本文将深入解析 LangChain 的 Deep Research 模块，包括其架构与功能特性，
并对比当前主流深度研究产品（OpenAI GPT-4 检索、Anthropic Claude、Manus、Camel-AI Eigent）的异同。
在此基础上，我们分析 LangChain Deep Research 的不足，并通过源码实例讲解其中关键机制的实现和优化空间。

## LangChain Deep Research 模块概览

### 技术架构与流程

LangChain 的 Open Deep Research 是一个多阶段、多代理的研究代理，构建于 LangChain 新推出的 LangGraph 框架之上。其整体流程分为三个阶段：
1. **Scope（确定范围）**：利用LLM与用户澄清对话，生成研究提纲
2. **Research（检索研究）**：主管代理拆分任务，并行调度子代理检索
3. **Write（报告撰写）**：汇总子代理结果生成结构化报告

架构采用**"主管-子代理"调度模式**：

- 研究主管代理（Supervisor）根据用户请求规划任务
- 并行调度多个子代理（Sub-Agent）执行子课题检索
- 子代理完成后生成内容并附来源引用
- 主管代理汇总结果并生成最终报告

![simple.png](https://blog.langchain.com/content/images/size/w1600/2025/07/simple.png)


#### **Scope 阶段**：
   在Scope 阶段，系统首先利用LLM与用户进行澄清对话，以获取完整需求上下文。
   随后，生成一份研究提纲 (research brief)，明确研究范围、要点和成功标准。
   提纲相当于后续研究的“北极星”，指导代理深入检索并避免偏题。
   由于用户初始请求往往信息不足，这一阶段通过补充提问和示例，使模型精准理解用户意图。

- 通过澄清对话获取完整需求上下文
- 生成研究提纲（research brief）明确范围、要点和成功标准
- 提纲作为后续研究的"北极星"指导方向

![image2.png](https://blog.langchain.com/content/images/2025/07/scope.png)
- User Clarification
![image3.png](https://blog.langchain.com/content/images/2025/07/brief.png)
- Brief Generation
![image4.png](https://blog.langchain.com/content/images/2025/07/actualbrief.png)

#### **Research 阶段**：
   在Research阶段，进入多代理协作检索：研究主管代理读取提纲，将总任务按主题或子问题拆分成若干独立的子任务。
   对于每个子任务，主管生成一个子代理指令，说明该子代理只需关注特定主题，无需关心全局。
   然后主管并行启动多个子代理（典型默认最多 5 个），分别执行工具调用循环（如网络搜索和MCP工具）
   来搜集各自领域的信息。这种并行多线程检索避免了单代理串行搜索的上下文混杂和低效——Anthropic 的评估显示，
   多代理并行在广度型查询上比单代理提升90%性能。每个子代理在检索若干轮后，都会调用LLM将所得资料整理撰写成
   该子课题的详尽回答，并引用关键来源。为减少无关冗余信息占用上下文，每个子代理还会对自身结果做压缩清洗
   （剔除失败的工具调用痕迹和不相关内容）再返回主管。研究主管收集所有子代理的结果后，会判断是否满足提纲要求，
   若有遗漏可进一步发起迭代研究（例如再深入某子主题或新增子主题），直至信息充分。

- 主管代理按主题拆分任务
- 并行启动子代理（默认最多5个）
- 每个子代理执行工具调用循环（网络搜索/MCP工具）
- 子代理对结果压缩清洗后返回主管
- 主管判断信息完整性并触发迭代研究

![image5.png](https://blog.langchain.com/content/images/size/w1600/2025/07/research.png)

#### **Write 阶段**：
   在Write 阶段，当研究信息足够后，主管进入报告撰写。此时将研究提纲以及所有经清洗的子代理研究结果，
   一并提供给一个LLM，请其一次性生成最终报告。生成的报告针对提纲要求进行完整回答，并严格依据研究结果撰写，
   确保内容有据可依。报告通常采用结构化Markdown格式，包含引言、各章节内容以及结论等，字数往往较多且
   插入引用以保证可追溯出处。这种“集中书写”方式避免了让多个子代理各写报告段落可能产生的风格不一致、
   上下文割裂问题。

- 主管将提纲和子代理结果提供给LLM
- 一次性生成结构化Markdown报告
- 报告包含引言、正文、结论和引用
- "集中书写"保证风格一致性

![image6.png](https://blog.langchain.com/content/images/2025/07/one-shot.png)


#### **底层支撑**：
   底层支撑方面，LangChain Deep Research 充分利用了 LangGraph 提供的长生命周期、有状态执行能力。
   代理的对话历史、提纲、子代理结果等都维护在有状态工作流中，使长时间运行不丢失中间状态，并支持出错恢复
   和人为检查。此外，LangGraph 的调度使并行子代理协作、更复杂的子图流程成为可能，同时支持人类中控
   （随时监视和干预代理状态）以提高可靠性。这些架构设计保证了 Deep Research 代理在处理开放式、
   步骤不确定的研究任务时具备灵活策略和稳健执行的能力。

- 利用 LangGraph 的长生命周期有状态执行能力
- 维护对话历史、提纲和中间状态
- 支持出错恢复和人为检查
- 实现复杂子图流程和人类中控

![image6.png](https://blog.langchain.com/content/images/2025/07/multi-agent.png)

### 主要功能特性

1. **多轮网络检索与信息汇总**
   - 自主生成多跳搜索查询
   - 子代理在独立上下文内反复调用搜索引擎
   - 主管整合多源信息形成完整答案

2. **引用来源保证信息可追溯**
   - 每条重要论断附来源引用
   - 引用形式为文内标注或链接
   - 提高报告可信度和透明度

3. **分段写作与链式思维控制**
   - 通过链式思考（Chain-of-Thought）引导任务
   - 提示策略控制代理行为
   - 执行搜索→分析→精简循环

4. **内存与上下文管理**
   - Scope阶段浓缩对话成提纲
   - 子代理独立处理子课题
   - 结果返回前裁剪无关信息
   - 显著降低令牌消耗

5. **工具集成与插件机制**
   - 默认集成网络搜索API和MCP工具
   - 支持配置不同搜索服务
   - 插件式工具配置（通过.env或UI）
   - 支持函数式调用（类似OpenAI function calling）

6. **易用的界面与配置**
   - 提供 LangGraph Studio 和 Open Agent Platform (OAP)
   - 可视化查看执行流程和调试提示
   - 支持自定义：并发子代理数、迭代轮次、模型选择等

### 典型适用场景

| 场景类型 | 示例 | 优势 |
|---------|------|------|
| 比较分析类 | "对比产品A和B的优缺点" | 多代理使其对每个对象进行深入搜索，再生成对比报告（类似人类先各自调研再比较） |
| 开放式列举类 | "找出某领域排名前20的人选" | 传统检索很难一下找到20个，但深度研究代理可以不断追踪不同来源累积结果。 |
| 事实验证类 | "X说法是否属实？" | 其 iterative 策略和注重来源的特点，使其擅长谣言查证和事实核查任务。 |
| 复杂知识汇总类 | "解读长篇报告提炼要点" | 代理可将长文分段由不同子代理阅读总结，再汇总出一份提炼报告。这相当于多人阅读长文各写摘要，再合并成果，效率和质量都较高。 |
| 决策情报类 | 市场调研、竞品分析 | 代理可以并行收集多个来源的数据（官网、新闻、评价），并整理成决策报告，节省人工调研的大量时间。 |
| 跨领域综合类 | "分析技术科研现状与应用" | 这种问题涉及多个维度，Deep Research 可拆分成学术、产业、公众舆论等子课题分别研究，最后由主管融合成一篇全面报告。 |

## 深度研究代理对比：LangChain vs OpenAI vs Anthropic vs Manus vs Camel-AI

### 技术架构对比

| 方案 | 架构特点 | 优势 | 劣势 |
|------|----------|------|------|
| **LangChain** | 多代理+多阶段架构<br>Supervisor协调Sub-Agent | 灵活探索+上下文独立 | 子代理间缺少中途交流 |
| **OpenAI GPT-4** | 单智能体序贯工具调用 | 部署简单+高质量语言组织 | 线性流程效率低 |
| **Anthropic Claude** | 主代理+子代理+独立CitationAgent | 高可信度+引文精确 | 闭源商用不可定制 |
| **Manus** | 分布式Agent群（Wide模式） | 超大规模并行（100+代理） | 黑盒操作+资源消耗大 |
| **Camel-AI Eigent** | 开放式多Agent编排 | 高度自定义+本地优先 | 配置复杂度高 |

### 功能能力对比

| 方案 | 核心能力 | 特色功能 | 局限 |
|------|----------|----------|------|
| **LangChain** | 多轮检索+多文档归纳 | 来源引用+结构化报告 | 实时性和多媒体处理弱 |
| **OpenAI** | 单代理串行检索 | 高质量语言表述 | 缺少平行检索机制 |
| **Anthropic** | 平行思考+引文检查 | AI自改善提示工程 | 聚焦文本分析 |
| **Manus** | 研究转行动 | 操作型工具（浏览器控制等） | 封闭不可控 |
| **Camel-AI** | 自由定制Agent角色 | 200+工具适配+本地运行 | 需编排设计能力 |

### 用户可控性与可扩展性

| 方案 | 可控性 | 扩展机制 | 适用场景 |
|------|--------|----------|----------|
| **LangChain** | 完全开源+插件配置 | 替换LLM/搜索源/Prompt | 开发者定制 |
| **OpenAI** | 几乎不可控 | 有限API扩展 | 开箱即用 |
| **Anthropic** | API外围控制 | Claude on your data | 企业级应用 |
| **Manus** | 仅任务输入控制 | 无扩展接口 | 大众用户 |
| **Camel-AI** | 完全开源+高度定制 | 自由组装Agent团队 | 研发人员DIY |

### 开源 vs 闭源、社区与维护性

| 方案 | 开源状态 | 社区规模 | 维护性 |
|------|----------|----------|--------|
| **LangChain** | MIT许可 | 6万+⭐主库 | 专业团队+社区保障 |
| **OpenAI** | 闭源SaaS | API文档+论坛 | 供应风险 |
| **Anthropic** | 闭源服务 | 商业支持 | 依赖厂商 |
| **Manus** | 闭源商业 | 小型私域 | 初创风险 |
| **Camel-AI** | 完全开源 | 2000+成员 | 社区共建 |

### 代码复杂度与依赖性

| 方案 | 实现复杂度 | 依赖项 | 部署难度 |
|------|------------|--------|----------|
| **LangChain** | 中等偏上 | LangChain+LangGraph+API密钥 | 模块化配置 |
| **OpenAI** | 零复杂度 | 官方SDK/API | 最简单 |
| **Anthropic** | 不可见 | Claude API | 云端完成 |
| **Manus** | 云端隐藏 | 联网使用 | 完全依赖厂商 |
| **Camel-AI** | 中高复杂度 | Python+Node.js+本地模型 | 需要开发能力 |

## LangChain Deep Research 的不足与源码解析

### 主要不足

1. #### **高Token消耗与成本问题**
   高Token消耗与成本问题：多代理并行和多轮工具调用意味着生成大量Token。正如Anthropic指出，多代理研究比普通对话Token使用高出约15倍。
   LangChain虽通过上下文压缩缓解，但在处理超长文档或非常广的课题时，仍可能遇到上下文长度瓶颈或费用高昂的问题。如果用户不加限制地提高并发
   子代理数量和搜索轮数，成本会线性上涨。如何智能地控制代理搜索深度、过滤无效内容仍有优化空间。例如，引入自适应搜索终止条件，根据信息增益
   决定是否继续，而不是固定迭代次数。   

   - 多代理并行导致Token使用量激增
   - 需智能控制搜索深度（自适应终止条件）

2. #### **多代理协调与重复风险**
   多代理系统一个固有挑战是子代理可能目标重叠或互相干扰。LangChain Deep Research目前通过让每个子代理只看自己的topic来避免串话。
   但如果用户请求的子话题存在关联（例如交叉领域），子代理仍可能检索到重复内容或遗漏需要协作的部分。当前架构中，子代理彼此独立检索，缺少中途
   交流机制，只有主管汇总阶段才能发现重复或缺口。这可能导致报告部分内容冗余或章节衔接不紧密。改进思路是在主管代理层面增加子代理任务规划的
   优化：例如先搜集所有子代理找到的来源列表，消除重复，再指导尚未完成的子代理避开这些来源，以减少冗余。或者引入一个全局观察者Agent，在子
   代理进行过程中监控其进展并提示调整策略。另外，LangChain早期尝试让子代理并行写报告各章节，但效果不好，于是改为集中写作。如何既利用并行
   又保持章节连贯，依然值得探索。

   - 子代理可能目标重叠
   - 缺少中途交流机制
   - 改进思路：全局观察者Agent监控

3. #### **本地化和长期知识**
   LangChain Deep Research依赖于在线搜索，对专有本地知识或长远记忆支持不足。如果研究课题涉及用户自有文档或历史研究结果，目前框架并未
   整合向量数据库或长时记忆模块来利用它们。这方面可以借鉴AutoGPT等的内存机制，或LangChain自家的RetrievalQA链，将Deep Research产生的
   知识存档，用于下次类似问题的加速回答。此外，Deep Research产生的详尽报告本身就是很有价值的知识，每次都从头研究有些浪费。如果引入知识库
   缓存（哪怕简单地将报告存入数据库，下次遇到相关问题时优先引用），将提升效率。然而如何保证知识不过时、何时触发重新检索，这是实现中的难点，
   需要更智能的策略。
   
   - 未整合向量数据库
   - 缺乏知识重用机制
   - 改进方向：引入知识库缓存

4. #### **代码与文档**
   对于开发者用户来说，LangChain Deep Research的代码文档较简略，上手不易。一些功能需要通过博客或案例才能明白。比如open_deep_research
   仓库中只有README描述配置，核心逻辑埋在LangGraph Graph定义里，不阅读源码难以理解全貌。这对社区贡献和二次开发是门槛。希望后续LangChain
   团队能提供更详细的架构讲解文档，或者像Camel社区那样提供教程范例，帮助开发者定制Deep Research流程。

   - 核心逻辑埋在LangGraph定义中
   - 需要更详细架构文档

### 源码解析：多代理调度

```python

# supervisor_tools 函数简化片段
if sections_list:
    # 规划报告章节后并行发送给子代理
    return Command(
        goto=[Send("research_team", {"section": s}) for s in sections_list],
        update={"messages": result}
    )

# research_agent_tools 函数简化片段
if completed_section:
    # 子代理完成章节写作后返回
    return {
        "messages": result,
        "completed_sections": [completed_section]
    }

```

### 关键机制：

* 自动任务拆分：Supervisor通过Sections工具获取章节列表
* 并行子代理执行：LangGraph的Send命令启动并行任务
* 上下文隔离：每个子代理仅接收自己的section参数
* 同步汇总：LangGraph等待所有子代理返回

### 优化方向：

* 基于知识图谱的智能任务划分
* 动态增减子代理（层次化子代理）
* 子代理间适度通信
* 自适应并发度控制

### 源码解析：报告撰写

#### 核心流程：

* 子代理调用Section工具生成章节内容
* 主管整理completed_sections
* 触发写作模型生成引言/结论
* 按顺序拼接最终报告

#### 优化空间：

* 引用校验步骤确保准确性
* 压缩机制避免上下文超限
* 模板化输出保证格式统一
* 分段写作+长上下文模型支持

## 结语
LangChain Deep Research 展示了多智能体协作在复杂信息检索任务上的强大潜力，其核心价值在于：

* 用LLM+工具实现自动规划和并行执行
* 开源方式让研究代理走向大众开发者
* LangGraph框架支持状态管理和错误恢复

### 未来方向：

* 更智能的Agent调度机制
* 长期记忆和知识重用
* 多模态能力扩展
* 生成结果准确度提升
* 深度研究代理让专业知识的获取和整合变得前所未有地高效，随着技术成熟，人人都将拥有专属的AI研究员

## 参考文献
 1.	[LangChain Blog. Open Deep Research, Jul 16 2025.](https://blog.langchain.com/open-deep-research/?utm_source=chatgpt.com)
 2.	[LangChain GitHub. open_deep_research Repository, 2025. ](https://github.com/langchain-ai/open_deep_research?utm_source=chatgpt.com)
 3.	[Anthropic Engineering Blog. How we built our multi-agent research system, Jun 13 2025. ](https://www.anthropic.com/engineering/built-multi-agent-research-system?utm_source=chatgpt.com)
 4.	[OpenAI Blog. Introducing Deep Research, Feb 2 2025. ](https://openai.com/index/introducing-deep-research/?utm_source=chatgpt.com)
 5.	[OpenAI Help Center. Deep Research FAQ, 2025. ](https://help.openai.com/en/articles/10500283-deep-research-faq?utm_source=chatgpt.com)
 6.	[The Indian Express. “Manus has positioned Wide Research…”, Aug 3 2025.](https://indianexpress.com/article/technology/artificial-intelligence/what-is-wide-research-manus-multi-agent-ai-tool-openai-google-10167139/?utm_source=chatgpt.com)
 7.	[Business Insider. “I tested Manus, China’s ‘fully autonomous’ AI agent…”, Apr 2025. ](https://www.businessinsider.com/manus-early-access-test-general-ai-agent-china-deepseek-2025-3?utm_source=chatgpt.com)
 8.	[Camel-AI. Eigent — World’s First Multi-agent Workforce, 2025. ](https://www.camel-ai.org/?utm_source=chatgpt.com)
 9.	[LangChain GitHub. local-deep-researcher Repository, 2025. ](https://github.com/langchain-ai/local-deep-researcher?utm_source=chatgpt.com)
 10.	[Camel-AI GitHub. CAMEL Framework, 2025.](https://github.com/camel-ai/camel?utm_source=chatgpt.com)

