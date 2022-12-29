#include <iostream>

int main() 
{
	const std::string exclam = "!";
	const std::string message = "Hello" + ", world" + exclam;
	std::cout << message << std::endl;
}