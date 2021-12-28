use std::fmt::Write;
use syntect::{
    html::ClassStyle,
    parsing::{
        BasicScopeStackOp, ParseState, Scope, ScopeStack, ScopeStackOp, SyntaxReference, SyntaxSet,
        SCOPE_REPO,
    },
    util::LinesWithEndings,
};

/// The ClassedTableGenerator generates HTML tables of the following form:
/// <table>
///   <tbody>
///     <tr>
///       <td class="line" data-line="1">
///       <td class="code">
///         <span class="hl-source hl-go">
///           <span class="hl-keyword hl-control hl-go">package</span>
///           main
///         </span>
///       </td>
///     </tr>
///   </tbody>
/// </table
///
/// If max_line_len is not None, any lines with length greater than the
/// provided number will not be highlighted.
pub struct ClassedTableGenerator<'a> {
    syntax_set: &'a SyntaxSet,
    parse_state: ParseState,
    stack: ScopeStack,
    html: String,
    style: ClassStyle,
    code: &'a str,
    max_line_len: Option<usize>,
    filepath: String,
}

impl<'a> ClassedTableGenerator<'a> {
    pub fn new(
        ss: &'a SyntaxSet,
        sr: &SyntaxReference,
        code: &'a str,
        max_line_len: Option<usize>,
        style: ClassStyle,
        filepath: String,
    ) -> Self {
        ClassedTableGenerator {
            code,
            syntax_set: ss,
            parse_state: ParseState::new(sr),
            stack: ScopeStack::new(),
            html: String::with_capacity(code.len() * 8), // size is a best guess
            style,
            max_line_len,
            filepath,
        }
    }

    // generate takes ownership of self so that it can't be re-used
    pub fn generate(mut self) -> String {
        open_table(&mut self.html);

        for (i, line) in LinesWithEndings::from(self.code).enumerate() {
            open_row(&mut self.html, i);
            if self.max_line_len.map_or(false, |n| line.len() > n) {
                self.write_escaped_html(&line);
            } else {
                self.write_spans_for_line(&line, i);
            }
            close_row(&mut self.html);
        }

        close_table(&mut self.html);
        self.html
    }

    // open_current_scopes opens a span for every scope that was still
    // open from the last line
    fn open_current_scopes(&mut self) {
        for scope in self.stack.clone().as_slice() {
            self.open_scope(scope)
        }
    }

    fn close_current_scopes(&mut self) {
        for _ in 0..self.stack.len() {
            self.close_scope()
        }
    }

    fn open_scope(&mut self, scope: &Scope) {
        self.html.push_str("<span class=\"");
        self.write_classes_for_scope(scope);
        self.html.push_str("\">");
    }

    fn close_scope(&mut self) {
        self.html.push_str("</span>");
    }

    fn write_spans_for_line(&mut self, line: &str, line_number: usize) {
        // Whenever we highlight a new line, the all scopes that are still open
        // from the last line must be created. Since scope spans can't cross table
        // row boundaries, we need to open and close scope spans that are shared
        // between lines on every line.
        //
        // For example, for a go file, every line should likely start with
        // <span class="hl-source hl-go">
        self.open_current_scopes();
        let filepath = &self.filepath;
        let parsed_line = self.parse_state.parse_line_2(line, self.syntax_set,
            INTERRUPT.clone(), line_number, filepath);
        self.write_spans_for_tokens(line, parsed_line.as_slice());
        self.close_current_scopes();
    }

    // write_spans_for_tokens creates spans for the list of tokens passed to it.
    // It modifies the stack of the ClassedTableGenerator, adding any scopes
    // that are unclosed at the end of the line.
    //
    // This is modified from highlight::tokens_to_classed_spans
    fn write_spans_for_tokens(&mut self, line: &str, ops: &[(usize, ScopeStackOp)]) {
        let mut cur_index = 0;

        // check and skip empty inner <span> tags
        let mut span_empty = false;
        let mut span_start = 0;

        for &(i, ref op) in ops {
            if i > cur_index {
                span_empty = false;
                self.write_escaped_html(&line[cur_index..i]);
                cur_index = i
            }
            let mut stack = self.stack.clone();
            stack.apply_with_hook(op, |basic_op, _| match basic_op {
                BasicScopeStackOp::Push(scope) => {
                    span_start = self.html.len();
                    span_empty = true;
                    self.open_scope(&scope);
                }
                BasicScopeStackOp::Pop => {
                    if span_empty {
                        self.html.truncate(span_start);
                    } else {
                        self.close_scope();
                    }
                    span_empty = false;
                }
            });
            self.stack = stack;
        }
        self.write_escaped_html(&line[cur_index..]);
    }

    // write_classes_for_scope is modified from highlight::scope_to_classes
    fn write_classes_for_scope(&mut self, scope: &Scope) {
        let repo = SCOPE_REPO.lock().unwrap();
        for i in 0..(scope.len()) {
            let atom = scope.atom_at(i as usize);
            let atom_s = repo.atom_str(atom);
            if i != 0 {
                self.html.push_str(" ")
            }
            if let ClassStyle::SpacedPrefixed { prefix } = self.style {
                self.html.push_str(&prefix)
            }
            self.html.push_str(atom_s);
        }
    }

    fn write_escaped_html(&mut self, s: &str) {
        write!(&mut self.html, "{}", Escape(s)).unwrap()
    }
}

fn open_table(s: &mut String) {
    s.push_str("<table><tbody>");
}

fn close_table(s: &mut String) {
    s.push_str("</tbody></table>");
}

fn open_row(s: &mut String, i: usize) {
    write!(
        s,
        "<tr><td class=\"line\" data-line=\"{}\"/><td class=\"code\"><div>",
        i + 1
    )
    .unwrap();
}

fn close_row(s: &mut String) {
    s.push_str("</div></td></tr>");
}

use std::fmt;

use crate::INTERRUPT;

/// Wrapper struct which will emit the HTML-escaped version of the contained
/// string when passed to a format string.
/// TODO(camdencheek): Use the upstream version of this once
/// https://github.com/trishume/syntect/pull/330 is merged
pub struct Escape<'a>(pub &'a str);

impl<'a> fmt::Display for Escape<'a> {
    fn fmt(&self, fmt: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Because the internet is always right, turns out there's not that many
        // characters to escape: http://stackoverflow.com/questions/7381974
        let Escape(s) = *self;
        let pile_o_bits = s;
        let mut last = 0;
        for (i, ch) in s.bytes().enumerate() {
            match ch as char {
                '<' | '>' | '&' | '\'' | '"' => {
                    fmt.write_str(&pile_o_bits[last..i])?;
                    let s = match ch as char {
                        '>' => "&gt;",
                        '<' => "&lt;",
                        '&' => "&amp;",
                        '\'' => "&#39;",
                        '"' => "&quot;",
                        _ => unreachable!(),
                    };
                    fmt.write_str(s)?;
                    last = i + 1;
                }
                _ => {}
            }
        }

        if last < s.len() {
            fmt.write_str(&pile_o_bits[last..])?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::{highlight, Query};

    fn test_css_table_highlight(q: Query, expected: &str) {
        let result = highlight(q);
        assert_eq!(json!({"data": expected, "plaintext": false}), result);
    }

    #[test]
    fn simple_css() {
        let query = Query {
            filepath: "test.go".to_string(),
            code: "package main\n".to_string(),
            line_length_limit: None,
            extension: String::new(),
            theme: String::new(),
            css: true,
        };
        let expected = "<table>\
                            <tbody>\
                                <tr>\
                                    <td class=\"line\" data-line=\"1\"/>\
                                    <td class=\"code\">\
                                        <div>\
                                            <span class=\"hl-source hl-go\">\
                                                <span class=\"hl-keyword hl-other hl-package hl-go\">package</span> \
                                                <span class=\"hl-variable hl-other hl-go\">main</span>\n\
                                            </span>\
                                        </div>\
                                    </td>\
                                </tr>\
                            </tbody>\
                        </table>";
        test_css_table_highlight(query, expected)
    }

    // See https://github.com/sourcegraph/sourcegraph/issues/20537
    #[test]
    fn long_line_gets_escaped() {
        let query = Query {
            filepath: "test.html".to_string(),
            code: "<div>test</div>".to_string(),
            line_length_limit: Some(10),
            extension: String::new(),
            theme: String::new(),
            css: true,
        };
        let expected = "<table>\
                            <tbody>\
                                <tr>\
                                    <td class=\"line\" data-line=\"1\"/>\
                                    <td class=\"code\">\
                                        <div>&lt;div&gt;test&lt;/div&gt;</div>\
                                    </td>\
                                </tr>\
                            </tbody>\
                        </table>";
        test_css_table_highlight(query, expected)
    }

    #[test]
    fn no_highlight_long_line() {
        let query = Query {
            filepath: "test.go".to_string(),
            code: "package main\n".to_string(),
            line_length_limit: Some(5),
            extension: String::new(),
            theme: String::new(),
            css: true,
        };
        let expected = "<table>\
                            <tbody>\
                                <tr>\
                                    <td class=\"line\" data-line=\"1\"/>\
                                    <td class=\"code\">\
                                        <div>package main\n</div>\
                                    </td>\
                                </tr>\
                            </tbody>\
                        </table>";
        test_css_table_highlight(query, expected)
    }

    #[test]
    fn multi_line_java() {
        let query = Query {
            filepath: "test.java".to_string(),
            code: "package com.lwl.boot.model;\n\npublic class Item implements Serializable {}"
                .to_string(),
            line_length_limit: None,
            extension: String::new(),
            theme: String::new(),
            css: true,
        };
        let expected = "<table>\
                            <tbody>\
                                <tr>\
                                    <td class=\"line\" data-line=\"1\"/>\
                                    <td class=\"code\">\
                                        <div>\
                                            <span class=\"hl-source hl-java\">\
                                                <span class=\"hl-meta hl-package-declaration hl-java\">\
                                                    <span class=\"hl-keyword hl-other hl-package hl-java\">package</span> \
                                                    <span class=\"hl-meta hl-path hl-java\">\
                                                        <span class=\"hl-entity hl-name hl-namespace hl-java\">\
                                                            com\
                                                            <span class=\"hl-punctuation hl-accessor hl-dot hl-java\">.</span>\
                                                            lwl\
                                                            <span class=\"hl-punctuation hl-accessor hl-dot hl-java\">.</span>\
                                                            boot\
                                                            <span class=\"hl-punctuation hl-accessor hl-dot hl-java\">.</span>\
                                                            model\
                                                        </span>\
                                                    </span>\
                                                </span>\
                                                <span class=\"hl-punctuation hl-terminator hl-java\">;</span>\n\
                                            </span>\
                                        </div>\
                                    </td>\
                                </tr>\
                                <tr>\
                                    <td class=\"line\" data-line=\"2\"/>\
                                    <td class=\"code\">\
                                        <div>\
                                            <span class=\"hl-source hl-java\">\n</span>\
                                        </div>\
                                    </td>\
                                </tr>\
                                <tr>\
                                    <td class=\"line\" data-line=\"3\"/>\
                                    <td class=\"code\">\
                                        <div>\
                                            <span class=\"hl-source hl-java\">\
                                                <span class=\"hl-meta hl-class hl-java\">\
                                                    <span class=\"hl-storage hl-modifier hl-java\">public</span> \
                                                    <span class=\"hl-meta hl-class hl-identifier hl-java\">\
                                                        <span class=\"hl-storage hl-type hl-java\">class</span> \
                                                        <span class=\"hl-entity hl-name hl-class hl-java\">Item</span>\
                                                    </span> \
                                                    <span class=\"hl-meta hl-class hl-implements hl-java\">\
                                                        <span class=\"hl-keyword hl-declaration hl-implements hl-java\">implements</span> \
                                                        <span class=\"hl-entity hl-other hl-inherited-class hl-java\">Serializable</span> \
                                                    </span>\
                                                    <span class=\"hl-meta hl-class hl-body hl-java\">\
                                                        <span class=\"hl-meta hl-block hl-java\">\
                                                            <span class=\"hl-punctuation hl-section hl-block hl-begin hl-java\">{</span>\
                                                            <span class=\"hl-punctuation hl-section hl-block hl-end hl-java\">}</span>\
                                                        </span>\
                                                    </span>\
                                                </span>\
                                            </span>\
                                        </div>\
                                    </td>\
                                </tr>\
                            </tbody>\
                        </table>";
        test_css_table_highlight(query, expected)
    }
}
