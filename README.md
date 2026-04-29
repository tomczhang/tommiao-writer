# tommiao-writer

汤姆喵公众号长文写作 skill。

这个 skill 用来帮助生成、续写、改写汤姆喵风格的公众号文章，重点服务于投资反思、投资体系构建、AI 工具实战、读后感延展、人生阶段总结和公共议题延展。

它的核心不是模仿某个外部作者，而是沉淀汤姆喵自己的近期主风格：

一个资深程序猿和重度 AI 使用者，用真实试错、工程化拆解和费曼式反思，尝试把投资、AI、人生选择权讲成普通人能理解、能执行、能共鸣的体系化文章。

## 适用场景

当你需要处理这些任务时使用：

- 写公众号文章
- 续写或扩写文章草稿
- 按汤姆喵风格改写素材
- 写投资反思、现金流、仓位管理、纪律、选择权相关内容
- 写 AI 工具、AI 分身、Agent、Claude Code、LangChain 相关内容
- 从机哥、金渐成、巴菲特、段永平、书籍或外部文章延展自己的理解
- 把一个公共议题拉回到普通人的处境和行动选择

## 安装方式

克隆到 Cursor 个人 skills 目录：

```bash
git clone https://github.com/tomczhang/tommiao-writer.git ~/.cursor/skills/tommiao-writer
```

如果本地已经存在同名目录，先备份或删除旧目录后再克隆。

## 目录结构

```text
tommiao-writer/
├── SKILL.md
├── README.md
└── references/
    ├── article_archetypes.md
    ├── banned_patterns.md
    ├── inspiration_patterns.md
    └── style_examples.md
```

## 文件说明

- `SKILL.md`：主规则，包含人格总纲、选题质检、文章原型、开头规则、叙事推进、语言风格、标题倾向和自检规则。
- `references/style_examples.md`：汤姆喵近期文章中的风格片段和口吻示例。
- `references/article_archetypes.md`：不同文章类型的结构模板。
- `references/inspiration_patterns.md`：从 budongjing、jinjiancheng、kazike、maobidao 中吸收的写作机制。
- `references/banned_patterns.md`：禁止写法和反例，避免投资大师味、AI 味、卡兹克味、过度短段和标点误用。

## 核心原则

- 先体感，再判断。
- 先心理，再金句。
- 前慢后重，前 1/3 多写现象和事实，后 1/3 再提高观点密度。
- 默认 3-4 句话一段，单句段只用于极强观点。
- 正文默认不用 `「」`，双引号也尽可能少用。
- 借外部作者的机制，不借外部作者的人设。

## 维护说明

这个 skill 会随着汤姆喵新的文章和人工修改反馈持续迭代。

如果某次生成内容被人工大幅修改，优先把修改背后的规则沉淀回 `SKILL.md` 或 `references/banned_patterns.md`。
