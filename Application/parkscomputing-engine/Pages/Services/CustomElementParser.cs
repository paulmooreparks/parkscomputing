using HtmlAgilityPack;
using System;
using System.Collections.Generic;
using System.Linq;

namespace ParksComputing.Engine.Pages.Services
{
    public class CustomElement
    {
        public string TagName { get; set; } = string.Empty;
        public Dictionary<string, string> Attributes { get; set; } = new Dictionary<string, string>();
        public string OriginalHtml { get; set; } = string.Empty;
    }

    public class CustomElementParser
    {
        public static List<CustomElement> ParseCustomElements(string html)
        {
            var elements = new List<CustomElement>();
            var doc = new HtmlDocument();
            doc.LoadHtml(html);

            // Find all custom elements (elements with hyphens in their names)
            var customNodes = doc.DocumentNode.SelectNodes("//*[contains(name(), '-')]") ?? new HtmlNodeCollection(null);

            foreach (var node in customNodes)
            {
                var element = new CustomElement
                {
                    TagName = node.Name,
                    OriginalHtml = node.OuterHtml
                };

                // Extract attributes
                foreach (var attr in node.Attributes)
                {
                    element.Attributes[attr.Name] = attr.Value;
                }

                elements.Add(element);
            }

            return elements;
        }

        public static string ReplaceCustomElement(string html, CustomElement element, string replacement)
        {
            return html.Replace(element.OriginalHtml, replacement);
        }
    }
}
